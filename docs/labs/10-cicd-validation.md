# LAB 10 - Kiểm Chứng Toàn Diện CI/CD & Khắc Phục Sự Cố

## Goal
Thực hành kiểm chứng toàn diện pipeline CI/CD của Monorepo `app2` thông qua 5 kịch bản thực tế (Scenarios A, B, C, D, E). Thử nghiệm kịch bản đo đạc RPO với chuỗi sequence marker trên `backend-3` kết nối Aurora PostgreSQL, và cung cấp cẩm nang xử lý sự cố (Troubleshooting Guide) chi tiết cho tất cả các tình huống lỗi.

## Prerequisites
- Đã hoàn thành toàn bộ các bài thực hành từ [LAB 00](00-application-structure.md) đến [LAB 09](09-gitops-handoff.md).
- Quyền truy cập vào repository GitHub `Kien-devops/app2` và tài khoản AWS.

## Files involved
- Toàn bộ Monorepo `app2`, pipeline `.github/workflows/ci.yml`, và `services/backend-3/src/db.js`.

## Step-by-step

### 1. Kiểm Chứng 5 Kịch Bản Thực Tế (Validation Scenarios)

---

#### Kịch Bản A (Scenario A): Chỉ thay đổi Frontend
- **Hành động**: Lập trình viên chỉnh sửa file giao diện `frontend/src/app.js` và commit lên nhánh `main`.
- **Kỳ vọng (Expected Behavior)**:
  - Job `detect-changes` phát hiện duy nhất thư mục `frontend/**`.
  - JSON Matrix: `["frontend"]`.
  - Job con `test-build-push (frontend)` được khởi chạy.
  - Cả 3 backends (`backend-1`, `backend-2`, `backend-3`) hoàn toàn **SKIP**.
  - Job `gitops-update` chỉ cập nhật duy nhất image tag cho `app2-frontend`.
  - **Kết quả ECR**: Đúng **1 image mới** được push lên `app2-frontend:<SHA>`.

```bash
# Thao tác mô phỏng cục bộ:
echo 'frontend/src/app.js' > /tmp/files_scenario_a.txt
bash ci/detect_changes.sh /tmp/files_scenario_a.txt
# Output: ["frontend"]
```

---

#### Kịch Bản B (Scenario B): Chỉ thay đổi Backend-2
- **Hành động**: Lập trình viên bổ sung mặt hàng trong danh mục tại `services/backend-2/src/app.js`.
- **Kỳ vọng (Expected Behavior)**:
  - Job `detect-changes` phát hiện duy nhất `services/backend-2/**`.
  - JSON Matrix: `["backend-2"]`.
  - Chỉ job con `test-build-push (backend-2)` được khởi chạy.
  - `frontend`, `backend-1`, và `backend-3` hoàn toàn **SKIP**.
  - Job `gitops-update` chỉ cập nhật image tag cho `app2-backend-2`.
  - **Kết quả ECR**: Đúng **1 image mới** được push lên `app2-backend-2:<SHA>`.

```bash
# Thao tác mô phỏng cục bộ:
echo 'services/backend-2/src/app.js' > /tmp/files_scenario_b.txt
bash ci/detect_changes.sh /tmp/files_scenario_b.txt
# Output: ["backend-2"]
```

---

#### Kịch Bản C (Scenario C): Thay đổi Thư viện Shared
- **Hành động**: Cập nhật hợp đồng kiểm tra sức khỏe trong `shared/src/health.js`.
- **Kỳ vọng (Expected Behavior)**:
  - Job `detect-changes` nhận diện cờ `all=true`.
  - JSON Matrix: `["frontend","backend-1","backend-2","backend-3"]`.
  - Toàn bộ 4 job con chạy song song đồng thời.
  - Đúng **4 images mới** được push lên cả 4 kho ECR tương ứng với cùng một `<SHA>`.
  - **ĐIỂM ĐẶC BIỆT**: Job `gitops-update` duy nhất chạy ở cuối, gom toàn bộ 4 cập nhật vào **DUY NHẤT 1 COMMIT & 1 PUSH** sang repo `aws-multi-region-dr-platform`, hoàn toàn không có race condition.

```bash
# Thao tác mô phỏng cục bộ:
echo 'shared/src/health.js' > /tmp/files_scenario_c.txt
bash ci/detect_changes.sh /tmp/files_scenario_c.txt
# Output: ["frontend","backend-1","backend-2","backend-3"]
```

---

#### Kịch Bản D (Scenario D): Mở Pull Request vào nhánh `main`
- **Hành động**: Tạo branch mới `feature/update-orders`, sửa file trong `services/backend-3/`, và mở PR vào `main`.
- **Kỳ vọng (Expected Behavior)**:
  - Pipeline kích hoạt qua trigger `pull_request`.
  - `backend-3` chạy qua: `Test component` (9 tests) -> `Verify Dockerfile` -> `Build image` (kèm `pg`) -> `Run Trivy scan`.
  - Các bước `Configure AWS credentials via OIDC`, `Push image to ECR` và job `gitops-update` hiển thị trạng thái **SKIPPED**.
  - **Kết quả ECR & GitOps**: Hoàn toàn không có image hay commit rác nào được sinh ra.

---

#### Kịch Bản E (Scenario E): Merge Pull Request vào `main`
- **Hành động**: Reviewer duyệt và nhấn nút **Merge pull request** vào nhánh `main`.
- **Kỳ vọng (Expected Behavior)**:
  - Pipeline kích hoạt qua trigger `push` trên nhánh `refs/heads/main`.
  - Kiểm thử, build Docker từ root context, quét Trivy được thực thi lại trên commit merge.
  - Xác thực OIDC thành công với AWS STS.
  - Image được gắn thẻ với commit SHA và đẩy lên Amazon ECR Singapore (`ap-southeast-1`).
  - ECR tự động nhân bản sang Tokyo (`ap-northeast-1`).
  - Job `gitops-update` tự động commit tag SHA mới sang `aws-multi-region-dr-platform`.
  - Argo CD tại cả Singapore và Tokyo tự động đối soát và rolling update Pods trên EKS.

---

### 2. Kịch Bản Đo Đạc RPO Bằng Chuỗi Sequence Trên Backend-3

Trong bài kiểm tra thảm họa DR trên hạ tầng:
1. Client gửi luồng ghi liên tục các sequence marker:
   ```bash
   for i in $(seq -w 1 100); do
     curl -s -X POST http://backend-3:8083/api/v1/orders \
       -H "Content-Type: application/json" \
       -d "{\"item_id\":\"dr-sequence\",\"quantity\":1,\"marker\":\"SEQ-$i\"}"
     sleep 0.5
   done
   ```
2. Giả lập sự cố ngắt vùng chính (Unplanned Region Failover).
3. Đọc lại dữ liệu trên vùng Standby (Tokyo) sau khi Aurora thăng cấp Writer:
   ```bash
   curl -s "http://backend-3-tokyo:8083/api/v1/orders" | jq '.[0]'
   ```
4. Đối soát marker cuối cùng nhận được tại Tokyo so với marker cuối cùng client gửi thành công ở Singapore để xác định chính xác số lượng bản ghi thất thoát và độ trễ RPO thực tế.

---

### 3. Cẩm Nang Xử Lý Sự Cố Toàn Diện (Comprehensive Troubleshooting Guide)

| Tình huống lỗi | Dấu hiệu nhận biết trong Log | Nguyên nhân gốc rễ | Cách khắc phục triệt để |
|---|---|---|---|
| **1. No workflow triggered** | Không thấy lần chạy nào xuất hiện trong tab GitHub Actions | Tên nhánh không phải `main`, hoặc file YAML đặt sai đường dẫn | Kiểm tra file nằm đúng tại `.github/workflows/ci.yml`. Đảm bảo push vào nhánh `main` hoặc tạo PR target vào `main`. |
| **2. Wrong path filter** | Thay đổi tài liệu nhưng pipeline vẫn chạy build container | File nằm lẫn trong thư mục ứng dụng hoặc script detect diff sai | Kiểm tra `changed-files.txt` trong log job `detect-changes`. Đảm bảo các file tài liệu nằm trong `docs/**` hoặc `README.md`. |
| **3. Matrix empty** | Job build bị bỏ qua khi sửa file ứng dụng | Script `ci/detect_changes.sh` không match được case nhánh | Chạy `bash ci/test_detect_changes.sh` để kiểm tra toàn bộ 9 kịch bản path filter. |
| **4. Dockerfile not found** | `Dockerfile missing: <path>/Dockerfile` | File Dockerfile bị viết thường (`dockerfile`) hoặc đặt sai chỗ | Đảm bảo file được đặt tên chính xác là `Dockerfile` (viết hoa chữ D) ngay tại gốc thư mục của từng component. |
| **5. Tests fail** | `AssertionError` hoặc exit code khác 0 ở step test | Logic mã nguồn vi phạm test contract | Đọc chi tiết stack trace trong step `Test component`. Chạy test cục bộ bằng `bash ci/test_component.sh <path>` để debug trước khi push. |
| **6. ECR login fail** | `Error: Cannot perform docker login to ECR` | Thiếu quyền `ecr:GetAuthorizationToken` hoặc credentials OIDC không hợp lệ | Đảm bảo IAM Role có policy cho phép `ecr:GetAuthorizationToken` trên `Resource: "*"`. |
| **7. AssumeRoleWithWebIdentity fail** | `Not authorized to perform sts:AssumeRoleWithWebIdentity` | OIDC Trust Policy không khớp audience hoặc subject claim | Kiểm tra Trust Policy của IAM Role: `aud` phải là `sts.amazonaws.com`, và `sub` phải có `repo:Kien-devops/app2:ref:refs/heads/main`. |
| **8. Wrong OIDC sub** | Lỗi 403 khi chạy từ nhánh feature hoặc fork | Trust Policy chỉ cho phép nhánh `main` nhưng lại cố push từ nhánh khác | Đây là tính năng bảo mật mong muốn. Chỉ merge vào `main` mới được cấp quyền push. |
| **9. Repository does not exist** | `RepositoryNotFoundException: The repository with name 'app2-backend-1' does not exist` | ECR repository chưa được tạo trước tại `ap-southeast-1` | Khởi tạo repository trên AWS Console hoặc qua Terraform: `aws ecr create-repository --repository-name app2-backend-1 --region ap-southeast-1`. |
| **10. Image push denied** | `AccessDeniedException: User: ... is not authorized to perform: ecr:PutImage` | IAM Policy giới hạn sai resource ARN | Đảm bảo Resource trong IAM Policy có định dạng `arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/app2-*`. |
| **11. Trivy scan fail** | Trivy phát hiện lỗ hổng và trả về exit code 1 | Base image có lỗ hổng Critical chưa được vá | Xem bảng báo cáo Trivy. Nâng cấp base image lên phiên bản alpine mới nhất (`node:22-alpine`). Trong lab demo, `exit-code: 0` được dùng để kiểm tra mà không làm gãy pipeline. |
| **12. ECR replication chưa xuất hiện Tokyo** | Image có ở Singapore nhưng không thấy ở Tokyo sau vài phút | Bộ lọc Replication Rule đặt sai tiền tố | Kiểm tra cấu hình Replication trên ECR Singapore: filter prefix phải là `app2-` để áp dụng cho cả 4 repository. |
| **13. GitOps Hand-off Push Conflict** | `non-fast-forward push rejection` | Nhiều job cùng push GitOps repo cùng lúc | Đã được giải quyết triệt để nhờ chuyển sang single `gitops-update` job chạy một lần duy nhất sau khi matrix hoàn tất. |

---

## Commands
Cách kiểm tra và chẩn đoán toàn bộ trạng thái hệ thống:

```bash
# 1. Chạy toàn bộ test suite cục bộ của Monorepo (23 tests)
bash ci/test_component.sh frontend
bash ci/test_component.sh services/backend-1
bash ci/test_component.sh services/backend-2
bash ci/test_component.sh services/backend-3
bash ci/test_component.sh shared
bash ci/test_detect_changes.sh

# 2. Đóng gói cả 4 container từ root context
docker build -f frontend/Dockerfile -t local/app2-frontend:test .
docker build -f services/backend-1/Dockerfile -t local/app2-backend-1:test .
docker build -f services/backend-2/Dockerfile -t local/app2-backend-2:test .
docker build -f services/backend-3/Dockerfile -t local/app2-backend-3:test .
```

## Expected output
Tất cả các lệnh kiểm tra cục bộ hoàn thành với exit code 0:
- Toàn bộ test suite vượt qua (23/23 tests pass).
- Bộ kiểm thử phát hiện thay đổi vượt qua (9/9 scenarios pass).
- Cả 4 container build thành công và chạy ổn định.

## Verification
- Xác nhận sau khi hoàn thành quy trình, hệ thống CI vận hành hoàn toàn tự động, tin cậy, và bảo vệ chặt chẽ hạ tầng đám mây.
- Các container image được gắn nhãn Git Commit SHA rõ ràng, sẵn sàng cho công cụ GitOps (Argo CD) đồng bộ sang cụm EKS tại cả 2 vùng Singapore và Tokyo.

## Security note
- Tuân thủ quy tắc vàng của DevSecOps: Mọi thay đổi mã nguồn đều phải qua kiểm thử đơn vị, đóng gói trong môi trường cô lập, quét lỗ hổng trước khi cấp quyền truy cập AWS.
- Giữ bí mật các định danh hạ tầng nhạy cảm và luôn kích hoạt MFA cho tài khoản quản trị AWS.

## Next step
Hoàn thành xuất sắc khóa học! Bạn đã làm chủ kiến trúc CI/CD monorepo hiện đại cho nền tảng Disaster Recovery đa vùng. Hãy quay lại đọc tổng quan tại [README.md](../../README.md).
