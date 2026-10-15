# LAB 07 - Đẩy Container Image Lên Amazon ECR

## Goal
Nắm rõ quy trình gắn thẻ (tagging) và đẩy container image lên Amazon Elastic Container Registry (ECR). Hiểu tại sao việc gắn thẻ bất biến (immutable tagging) bằng Git Commit SHA là bắt buộc đối với hệ thống sản xuất và GitOps, thay vì phụ thuộc vào tag `latest`.

## Prerequisites
- Đã hoàn thành [LAB 03](03-docker-build.md), [LAB 05](05-github-actions-ci.md) và [LAB 06](06-github-oidc-aws.md).
- Các ECR repository tương ứng đã được khởi tạo trên AWS:
  - `app2-frontend`
  - `app2-backend-1`
  - `app2-backend-2`
  - `app2-backend-3`
  - `app2-file-service`

## Files involved
- `.github/workflows/ci.yml` (Step `Login to Amazon ECR` và `Push image to Amazon ECR`)

## Step-by-step

### 1. Bảng Phân Ánh Repository ECR (Repository Mapping)

| Component trong Monorepo | Đường dẫn mã nguồn | Tên kho lưu trữ ECR | Vùng chính (Primary Region) |
|---|---|---|---|
| **frontend** | `frontend/` | `app2-frontend` | `ap-southeast-1` (Singapore) |
| **backend-1** | `services/backend-1/` | `app2-backend-1` | `ap-southeast-1` (Singapore) |
| **backend-2** | `services/backend-2/` | `app2-backend-2` | `ap-southeast-1` (Singapore) |
| **backend-3** | `services/backend-3/` | `app2-backend-3` | `ap-southeast-1` (Singapore) |
| **file-service** | `services/file-service/` | `app2-file-service` | `ap-southeast-1` (Singapore) |

### 2. Chiến Lược Gắn Thẻ Bất Biến (Immutable Tagging Strategy)

#### Tại sao tag `latest` là Anti-Pattern trong Production & GitOps?
1. **Mất tính bất biến (Mutable)**: Tag `latest` bị ghi đè sau mỗi lần build. Hai container chạy `app2-backend-1:latest` ở hai thời điểm khác nhau có thể chứa mã nguồn hoàn toàn khác nhau.
2. **Không thể Rollback an toàn**: Nếu một phiên bản mới phát sinh lỗi nghiêm trọng, bạn không thể ra lệnh cho Kubernetes rollback về phiên bản trước đó chỉ với tag `latest`.
3. **Bộ đệm Kubernetes không kéo image mới (ImagePullBackOff / Cached Layers)**: Nếu `imagePullPolicy` không phải là `Always`, kubelet sẽ giữ nguyên layer cũ trên node worker và không cập nhật code mới.
4. **Không thể đối soát (Audit Traceability)**: Khi phát hiện sự cố an ninh trong production, bạn không thể tra cứu ngay lập tức container đang chạy ứng với commit nào trên GitHub.

#### Tại sao Git Commit SHA là Primary Tag tối ưu?
Pipeline `app2` sử dụng **Git Commit SHA** (`${GITHUB_SHA}`) làm thẻ chính thức:
- **Rollback tức thì**: GitOps (Argo CD) chỉ cần sửa lại commit SHA trong manifest về phiên bản ổn định trước đó.
- **Audit & Compliance**: Mọi image digest liên kết 1-1 với commit log, người tạo PR, và kết quả kiểm thử.
- **Bảo đảm tính nguyên vẹn trong Disaster Recovery (DR)**: Khi đồng bộ sang vùng Tokyo, cả hai vùng đều chắc chắn đang chạy đúng cùng một SHA mà không bị xáo trộn phiên bản.
- **Supply Chain Security**: Cho phép tích hợp chữ ký số Cosign và tạo Software Bill of Materials (SBOM) gắn liền với từng commit.

Pipeline chỉ push tag SHA. Không push tag nhánh, `latest` hoặc `stable`; mọi image triển khai đều ánh xạ duy nhất tới một Git commit.

### 3. Quy trình Đăng nhập và Đẩy Image trong CI

1. **Step Login**: Sử dụng GitHub Action chính thức `aws-actions/amazon-ecr-login@v2`. Action này tự động lấy auth token từ ECR thông qua credentials tạm thời của OIDC và cấu hình Docker CLI.
2. **Step Gắn Thẻ và Push**:
   ```bash
   REGISTRY="${{ steps.ecr.outputs.registry }}"
   REPOSITORY="${{ steps.meta.outputs.repository }}"
   IMAGE="$REGISTRY/$REPOSITORY"

   # Gắn tag commit SHA
   docker tag "local/$REPOSITORY:${GITHUB_SHA}" "$IMAGE:${GITHUB_SHA}"
   docker push "$IMAGE:${GITHUB_SHA}"

   # Không tạo mutable tag như main/latest/stable.
   ```

## Commands
Cách thực hành thao tác ECR thủ công bằng terminal (nếu đã cấu hình AWS CLI):

```bash
# 1. Đăng nhập vào Amazon ECR vùng ap-southeast-1
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com

# 2. Gắn tag cho image Backend-1
COMMIT_SHA=$(git rev-parse HEAD)
docker tag local/app2-backend-1:v1.0.0 \
  <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/app2-backend-1:${COMMIT_SHA}

# 3. Đẩy image lên kho ECR
docker push <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/app2-backend-1:${COMMIT_SHA}

# 4. Kiểm tra danh sách image trong ECR repository
aws ecr describe-images \
  --repository-name app2-backend-1 \
  --region ap-southeast-1
```

## Expected output
Khi lệnh `docker push` hoàn thành thành công:

```text
The push refers to repository [<AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/app2-backend-1]
a1b2c3d4e5f6: Pushed
b2c3d4e5f6a1: Pushed
c3d4e5f6a1b2: Pushed
<COMMIT_SHA>: digest: sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069 size: 1158
```

## Verification
1. Truy cập AWS Console -> Dịch vụ **Amazon ECR** -> Region **ap-southeast-1 (Singapore)**.
2. Chọn repository `app2-backend-1`.
3. Kiểm tra danh sách image:
   - Xuất hiện tag bằng đúng mã commit SHA của GitHub.
   - Image tags chỉ hiển thị đúng `<COMMIT_SHA>`; không có tag mutable `main`, `latest` hoặc `stable`.
   - Dung lượng image nhỏ gọn và đúng kiến trúc `linux/amd64`.

## Troubleshooting
- **Lỗi `repository does not exist`**:
  - **Nguyên nhân**: Bạn chưa khởi tạo repository `app2-backend-1` trên ECR trong vùng `ap-southeast-1`.
  - **Khắc phục**: Tạo repository trước thông qua Terraform hạ tầng hoặc AWS Console:
    `aws ecr create-repository --repository-name app2-backend-1 --region ap-southeast-1`.
- **Lỗi `image push denied: AccessDeniedException`**:
  - **Nguyên nhân**: IAM Policy của Role OIDC chưa cấp đủ quyền `ecr:PutImage` hoặc resource ARN không khớp với tên repo.
  - **Khắc phục**: Kiểm tra lại Policy đã gắn `arn:aws:ecr:ap-southeast-1:<AWS_ACCOUNT_ID>:repository/app2-*`.
- **Lỗi `denied: Your authorization token has expired`**:
  - **Khắc phục**: Chạy lại step `aws-actions/amazon-ecr-login@v2` để lấy token đăng nhập Docker mới (token mặc định của ECR có hạn 12 giờ).

## Security note
- Kích hoạt tính năng **Tag Immutability** trên Amazon ECR để ngăn chặn hoàn toàn việc ai đó cố tình ghi đè lên tag SHA đã phát hành.
- Kích hoạt **Scan on push** trên ECR để AWS tự động quét thêm lỗ hổng bảo mật bằng Amazon Inspector.

## Next step
Chuyển sang [LAB 08 - Sao Chép Image Đa Vùng (ECR Cross-Region Replication)](08-ecr-multi-region.md) để tìm hiểu cách image tự động nhân bản sang vùng Tokyo phục vụ kế hoạch DR.
