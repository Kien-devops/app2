# LAB 05 - Thiết Kế Pipeline CI với GitHub Actions

## Goal
Phân tích toàn diện kiến trúc workflow CI/CD `.github/workflows/ci.yml`. Hiểu rõ cơ chế kích hoạt (triggers), ma trận động (dynamic matrix), đóng gói từ root context, chính sách quét bảo mật Trivy, và kiến trúc bàn giao GitOps đơn nhiệm (single `gitops-update` job) loại bỏ hoàn toàn race condition.

## Prerequisites
- Đã hoàn thành [LAB 02](02-testing.md), [LAB 03](03-docker-build.md) và [LAB 04](04-change-detection.md).
- Có tài khoản GitHub và quyền truy cập repository `Kien-devops/app2`.

## Files involved
- `.github/workflows/ci.yml` (Tệp định nghĩa pipeline chính)
- `ci/detect_changes.sh` & `ci/test_detect_changes.sh`
- `ci/test_component.sh`

## Step-by-step

### 1. Kiến Trúc Luồng Thực Thi 3-Job (3-Job Workflow Architecture)

Pipeline được tái cấu trúc thành 3 Job mạch lạc:

```text
               +--------------------------------------+
               |  Trigger: Push to main / Pull Request|
               +-------------------+------------------+
                                   │
                                   ▼
               +--------------------------------------+
               |         Job 1: detect-changes        |
               |  - Checkout repo (fetch-depth: 0)    |
               |  - Verify bash ci/test_detect_changes|
               |  - bash ci/detect_changes.sh         |
               |  - Output: matrix JSON & has_changes |
               +-------------------+------------------+
                                   │
                     has_changes == 'true' ?
                                   │
                                   ▼
               +--------------------------------------+
               |       Job 2: test-build-push         |
               |       (Dynamic Matrix Jobs)          |
               +-------------------+------------------+
                         │                 │
          +--------------+-----+     +-----+--------------+
          │                    │     │                    │
          ▼                    ▼     ▼                    ▼
      [frontend] [backend-1] [backend-2] [backend-3] [file-service]
          │                    │             │            │
          +--------------------+-------------+------------+
                               │
                   Các Step tuần tự trong mỗi Job:
                   1. Resolve metadata (path & repo name)
                   2. bash ci/test_component.sh <path>
                   3. Verify Dockerfile exists
                   4. docker build -f <path>/Dockerfile . (Root context)
                   5. Run Trivy vulnerability scan
                   6. If push on main:
                      - AssumeRole via GitHub OIDC
                      - Login to Amazon ECR
                      - Push tag :<SHA> & :main (Singapore ap-southeast-1)
                               │
                               ▼
               +--------------------------------------+
               |         Job 3: gitops-update         |
               | (Chạy DUY NHẤT 1 lần sau khi build)  |
               +-------------------+------------------+
                 - Đọc danh sách components đã build
                 - Clone repo aws-multi-region-dr-platform
                 - Cập nhật đúng image tag trong kustomization.yaml
                 - Tạo duy nhất 1 commit & 1 push lên main!
```

---

### 2. Chính Sách Quét Lỗ Hổng Bảo Mật Container (Trivy Scan Policy)

Pipeline tích hợp bộ quét container Trivy (`aquasecurity/trivy-action@0.29.0`) với lộ trình 2 giai đoạn rõ ràng:

- **Giai đoạn 1 (Lab Phase - Hiện tại)**:
  `exit-code: "0"` (Chế độ Audit/Audit Mode). Quét và lập bảng thống kê toàn bộ lỗ hổng mức `CRITICAL,HIGH` trong log nhưng không làm fail pipeline ngay lập tức, giúp học viên dễ dàng theo dõi và debug ứng dụng.
- **Giai đoạn 2 (Production Hardening Phase)**:
  `exit-code: "1"`. Bất kỳ lỗ hổng mức CRITICAL nào chưa được vá sẽ lập tức chặn đứng quá trình push image lên ECR, đảm bảo tiêu chuẩn an ninh DevSecOps nghiêm ngặt.

---

### 3. Nguyên tắc khác biệt giữa Pull Request và Push to `main`

| Giai đoạn Pipeline | Pull Request (PR) | Push vào `main` |
|---|:---:|:---:|
| **Detect Changes** | Có | Có |
| **Run Unit Tests** | Có | Có |
| **Docker Build** | Có | Có |
| **Trivy Vulnerability Scan** | Có | Có |
| **AssumeRole AWS OIDC** | **BỎ QUA** | **THỰC THI** |
| **Push Image lên ECR** | **BỎ QUA** | **THỰC THI** |
| **GitOps Update Manifests** | **BỎ QUA** | **THỰC THI** |

---

## Verification
- Xác nhận cú pháp YAML bằng lệnh:
  `node -e "require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')"`
- Kiểm tra toàn bộ matrix jobs chạy độc lập mà không can thiệp vào GitOps repo.

## Troubleshooting
- **Lỗi `Dockerfile missing`**: Đảm bảo file `Dockerfile` nằm ngay trong thư mục của từng component.
- **Lỗi `Trivy scan`**: Kiểm tra kết nối mạng và tag image cục bộ `local/<repository>:${GITHUB_SHA}`.

## Security note
- Phân quyền tối thiểu: Job `test-build-push` chỉ yêu cầu `contents: read` và `id-token: write`.
- Job `gitops-update` sử dụng biến token `GITOPS_GITHUB_TOKEN` nạp qua env, không in ra màn hình.

## Next step
Chuyển sang [LAB 06 - Xác Thực Không Dùng Khóa với GitHub OIDC & AWS IAM](06-github-oidc-aws.md) để tìm hiểu cấu hình Trust Policy.
