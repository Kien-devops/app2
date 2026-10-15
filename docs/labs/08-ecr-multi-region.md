# LAB 08 - Sao Chép Image Đa Vùng (ECR Cross-Region Replication)

## Goal
Nắm rõ kiến trúc sao chép container image giữa các vùng của AWS (Amazon ECR Cross-Region Replication). Hiểu lý do tại sao GitHub Actions **chỉ được phép push vào vùng Singapore (`ap-southeast-1`)** và để hạ tầng AWS tự động nhân bản sang vùng Tokyo (`ap-northeast-1`).

## Prerequisites
- Đã hoàn thành [LAB 07](07-ecr-push.md).
- Hiểu kiến trúc Disaster Recovery đa vùng của dự án `aws-multi-region-dr-platform`.

## Files involved
- `.github/workflows/ci.yml` (Cấu hình push ECR Singapore)
- Hạ tầng ECR Registry Replication trên AWS

## Step-by-step

### 1. Kiến Trúc Sao Chép Image Đa Vùng

```text
               GitHub Actions CI/CD
                        |
                        | 1. docker push (Duy nhất Singapore)
                        v
     +---------------------------------------+
     |   Primary Region (ap-southeast-1)     |
     |   Amazon ECR: app2-backend-1          |
     +-------------------+-------------------+
                         |
                         | 2. AWS ECR Cross-Region Replication
                         |    (Mạng backbone nội bộ AWS)
                         v
     +---------------------------------------+
     |   DR Standby Region (ap-northeast-1)  |
     |   Amazon ECR: app2-backend-1          |
     +---------------------------------------+
```

### 2. Tại sao CI KHÔNG ĐƯỢC push cả hai vùng từ GitHub Actions?

Nhiều đội ngũ mắc sai lầm cấu hình workflow GitHub Actions thực hiện 2 lần lệnh `docker push`: một lần sang Singapore và một lần sang Tokyo. Đây là một anti-pattern vì các lý do sau:
1. **Lãng phí thời gian và băng thông CI**: GitHub runner phải upload toàn bộ layer container qua mạng internet công cộng hai lần, làm tăng gấp đôi thời gian chạy pipeline.
2. **Nguy cơ sai lệch tính nguyên vẹn (Inconsistency)**: Nếu một kết nối mạng giữa runner và Tokyo bị gián đoạn giữa chừng, vùng dự phòng sẽ bị thiếu image hoặc có digest khác với vùng chính.
3. **AWS Backbone Network vượt trội**: Cơ chế ECR Native Replication truyền tải layer container qua mạng cáp quang riêng của AWS (AWS Global Infrastructure), mang lại tốc độ cao, độ trễ thấp và độ tin cậy tuyệt đối.
4. **Đồng nhất Digest mật mã (Exact Cryptographic Digest Match)**: ECR replication đảm bảo bản sao tại Tokyo có đúng giá trị sha256 digest như tại Singapore.

### 3. Cấu hình ECR Replication Rule trên AWS Console

Replication Rule được quản lý ở cấp độ **Registry** (áp dụng cho toàn bộ tài khoản trong vùng):
1. Đăng nhập AWS Console tại vùng chính: **ap-southeast-1 (Singapore)**.
2. Điều hướng tới **Amazon ECR** -> menu bên trái chọn **Private registry** -> **Replication**.
3. Bấm **Edit** cấu hình Replication:
   - Bấm **Add rule**.
   - **Destination**: Chọn Region `ap-northeast-1` (Asia Pacific - Tokyo).
   - **Repository filters**: Chọn `Apply to repositories that match prefixes` -> Nhập prefix:
     ```text
     app2-
     ```
   - (Tùy chọn) Chọn tài khoản đích là cùng tài khoản của bạn.
4. Bấm **Save**.

*Lưu ý: Trong dự án `aws-multi-region-dr-platform`, cấu hình này đã được tự động khai báo bằng module Terraform `aws_ecr_replication_configuration`.*

### 4. Thời gian trễ sao chép (Replication Latency)
- Quá trình sao chép giữa Singapore và Tokyo diễn ra gần như tức thì đối với các image kích thước nhỏ (~150MB của `app2`), thông thường hoàn thành trong vòng 15 đến 45 giây sau khi Singapore nhận image.
- ECR tự động nhân bản image manifest, các layer sha256 và tag SHA bất biến liên kết.

## Commands
Cách kiểm tra trạng thái replication bằng AWS CLI:

```bash
# 1. Kiểm tra cấu hình replication hiện tại ở Singapore
aws ecr get-registry-scanning-configuration --region ap-southeast-1

# 2. Kiểm tra danh sách image tại Singapore (Vùng gốc)
aws ecr describe-images \
  --repository-name app2-backend-1 \
  --region ap-southeast-1 \
  --query 'imageDetails[*].[imageTags,imageDigest,imagePushedAt]' \
  --output table

# 3. Kiểm tra danh sách image tại Tokyo (Vùng đích dự phòng)
aws ecr describe-images \
  --repository-name app2-backend-1 \
  --region ap-northeast-1 \
  --query 'imageDetails[*].[imageTags,imageDigest,imagePushedAt]' \
  --output table
```

## Expected output
Bảng kết quả tại cả 2 Region hiển thị cùng một giá trị `imageDigest` và danh sách `imageTags`:

```text
-----------------------------------------------------------------------------------------
|                                    DescribeImages                                     |
+------------------------------+----------------------------------+---------------------+
|  ["7f83b1657...", "main"]    |  sha256:7f83b1657ff1fc53b92...   | 2026-10-11T09:15:00Z|
+------------------------------+----------------------------------+---------------------+
```

## Verification
- Kiểm tra trên AWS Console tại Tokyo: Repository `app2-backend-1` xuất hiện image mới có tag trùng khớp với Git Commit SHA.
- Xác nhận EKS cluster tại Tokyo có thể kéo image này thành công:
  `docker pull <AWS_ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/app2-backend-1:<COMMIT_SHA>`

## Troubleshooting
- **Lỗi: Image đã push lên Singapore nhưng không xuất hiện tại Tokyo**:
  - **Nguyên nhân 1**: Repository filter trong Replication Rule không khớp. Nếu quy tắc để tiền tố `app2-` nhưng tên repo là `app2frontend` (thiếu dấu gạch ngang) thì replication sẽ bỏ qua.
  - **Nguyên nhân 2**: Repository chưa từng tồn tại ở Tokyo và quyền tự động tạo repository bị chặn bởi Service Control Policy (SCP). ECR replication mặc định sẽ tự động tạo repository ở vùng đích nếu chưa có.
  - **Khắc phục**: Kiểm tra cấu hình filter trong ECR Replication settings.
- **Lỗi phân quyền mã hóa KMS Cross-Region**:
  - **Nguyên nhân**: Nếu ECR tại Singapore dùng AWS KMS Customer Managed Key (CMK), ECR ở vùng Tokyo phải có quyền giải mã key đó hoặc ECR repository đích cần cấu hình KMS key tương ứng tại Tokyo.
  - **Khắc phục**: Với hệ thống demo DR, sử dụng mã hóa mặc định của ECR (Amazon ECR managed encryption key - AES-256) để đơn giản hóa quá trình sao chép liên vùng.

## Security note
- Mạng backbone của AWS được mã hóa hoàn toàn ở tầng vật lý (Physical Layer Encryption - MACsec) khi dữ liệu truyền xuyên lục địa giữa Singapore và Tokyo.
- Không cấu hình replication sang các tài khoản AWS bên ngoài nếu không có cơ chế Cross-Account ECR Permission Policy chặt chẽ.

## Next step
Chuyển sang [LAB 09 - Bàn Giao Triển Khai Cho GitOps (GitOps Handoff)](09-gitops-handoff.md) để tìm hiểu cách thức chuyển giao image tag mới sang repo hạ tầng `aws-multi-region-dr-platform`.
