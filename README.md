# app2 - Application Monorepo for AWS Multi-Region DR Platform

[![CI/CD Pipeline](https://github.com/Kien-devops/app2/actions/workflows/ci.yml/badge.svg)](https://github.com/Kien-devops/app2/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Repository mã nguồn ứng dụng mẫu (1 Frontend + 3 Microservices Backend + Thư viện Shared) kết nối cơ sở dữ liệu **Amazon Aurora PostgreSQL Global Database**, phục vụ trực tiếp cho kịch bản đo đạc **RPO/RTO** và thử nghiệm **Disaster Recovery (DR)** của dự án **[aws-multi-region-dr-platform](https://github.com/Kien-devops/aws-multi-region-dr-platform)**.

---

## 1. Mối Quan Hệ Giữa Hai Repository

Hệ thống tuân thủ nguyên tắc phân định trách nhiệm rõ ràng (**Separation of Concerns**):

| Repository | Trách Nhiệm Chính | Nội Dung |
|---|---|---|
| **[Kien-devops/app2](https://github.com/Kien-devops/app2)** *(Repo này)* | **Application Source Code & CI** | • Mã nguồn ứng dụng (Frontend + 3 Backends + Shared)<br>• Unit Testing & Contract validation<br>• Docker multi-stage builds (context root)<br>• Trivy security scanning<br>• Push container images lên Amazon ECR Singapore (`ap-southeast-1`)<br>• Job GitOps handoff tự động cập nhật image tag |
| **[Kien-devops/aws-multi-region-dr-platform](https://github.com/Kien-devops/aws-multi-region-dr-platform)** | **Infrastructure, GitOps & Multi-Region DR** | • Terraform/OpenTofu cấu hình hạ tầng AWS đa vùng (VPC, EKS, ECR, Route 53, Aurora Global DB)<br>• Argo CD GitOps manifests & Helm charts<br>• Quản lý quy trình Failover / Switchover giữa Singapore (`ap-southeast-1`) và Tokyo (`ap-northeast-1`) |

> **Nguyên tắc cốt lõi**: CI của `app2` **tuyệt đối không bao giờ** chứa cluster credentials hoặc thực hiện lệnh `kubectl apply` trực tiếp. Việc triển khai lên Kubernetes hoàn toàn do Argo CD trong repo `aws-multi-region-dr-platform` đảm nhiệm thông qua cơ chế Pull-based GitOps.

---

## 2. Kiến Trúc Ứng Dụng & Routing Thật

```text
                        Internet / Ingress Controller
                                      │
         ┌────────────────────────────┼────────────────────────────┬────────────────────────────┐
         │ (Path: /)                  │ (Path: /api/v1/info)       │ (Path: /api/v1/catalog)    │ (Path: /api/v1/orders)
         ▼                            ▼                            ▼                            ▼
  ┌──────────────┐             ┌──────────────┐             ┌──────────────┐             ┌──────────────┐
  │   frontend   │             │  backend-1   │             │  backend-2   │             │  backend-3   │
  │  (Port 3000) │             │  (Port 8081) │             │  (Port 8082) │             │  (Port 8083) │
  │  UI Gateway  │             │  Auth & Demo │             │  Catalog API │             │  Orders API  │
  └──────────────┘             └──────────────┘             └──────────────┘             └──────┬───────┘
                                                                                                │ (pg Pool)
                                                                                                ▼
                                                                                   ┌─────────────────────────┐
                                                                                   │ Aurora PostgreSQL       │
                                                                                   │ Global Database Writer  │
                                                                                   └─────────────────────────┘
```

### Bảng Phân Bổ Endpoints & Chức Năng

| Service | Port | Endpoint | Phương Thức | Mô Tả Nghiệp Vụ | Phản Hồi Mẫu |
|---|:---:|---|:---:|---|---|
| **frontend** | `3000` | `/health`<br>`/` | GET<br>GET | Giám sát trạng thái & UI Dashboard | `{"status":"ok","service":"frontend","region":"..."}` |
| **backend-1** | `8081` | `/health`<br>`/api/v1/info` | GET<br>GET | Dịch vụ Authentication & Metadata | `{"service":"backend-1","role":"Authentication & Demo Service"}` |
| **backend-2** | `8082` | `/health`<br>`/api/v1/catalog`<br>`/api/v1/info` | GET<br>GET<br>GET | Dịch vụ đọc danh mục sản phẩm (Catalog) | `[{"id":"item-001","name":"Cloud Server Instance","price":49.99}]` |
| **backend-3** | `8083` | `/health`<br>`/api/v1/info`<br>`/api/v1/orders`<br>`/api/v1/orders` | GET<br>GET<br>GET<br>POST | Dịch vụ quản lý đơn hàng kết nối PostgreSQL | GET: Danh sách đơn hàng gần nhất (hỗ trợ `?marker=...`)<br>POST (201): Tạo đơn hàng & ghi chuỗi sequence |

---

## 3. Database-Backed Orders API & Thử Nghiệm Đo Đạc RPO

`backend-3` kết nối trực tiếp với **Amazon Aurora PostgreSQL Global Database** thông qua thư viện `pg` và Connection Pool:

### Biến Môi Trường Cấu Hình:
- `DB_HOST`: Endpoint của Aurora Writer (ở vùng Singapore) hoặc Aurora Local Read/Write sau failover.
- `DB_PORT`: Port PostgreSQL (mặc định `5432`).
- `DB_USER`: Username đăng nhập (mặc định `postgres`).
- `DB_PASSWORD`: Mật khẩu (truyền qua Kubernetes Secret).
- `DB_NAME`: Tên cơ sở dữ liệu (mặc định `orders_db`).
- `DB_SSL`: `true` nếu yêu cầu kết nối mã hóa SSL/TLS.

### Bảng Dữ Liệu `orders`:
```sql
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  marker VARCHAR(255),
  item_id VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Đo Đạc RPO Thực Tế Khi Failover:
1. Script kiểm thử DR bên infra liên tục gửi request ghi chuỗi sequence:
   ```bash
   curl -X POST http://backend-3:8083/api/v1/orders \
     -H "Content-Type: application/json" \
     -d '{"item_id":"dr-sequence","quantity":1,"marker":"SEQ-000042"}'
   ```
2. Trong quá trình giả lập thảm họa sập vùng Singapore, Aurora Global Database thực hiện failover sang Tokyo (`ap-northeast-1`).
3. Sau khi phục hồi, đối soát:
   `last committed marker trước thảm họa` so với `last marker tồn tại sau failover`:
   ```bash
   curl "http://backend-3:8083/api/v1/orders?marker=SEQ-000042"
   ```
   Khoảng cách giữa hai giá trị cho phép tính toán chính xác giá trị **RPO (Recovery Point Objective)** tính bằng số lượng bản ghi hoặc thời gian thất thoát dữ liệu thực tế.

---

## 4. Contract Kiểm Tra Sức Khỏe (/health)

Tất cả các service đều sử dụng thư viện dùng chung `shared/src/health.js`. Định dạng phản hồi:
```json
{
  "status": "ok",
  "service": "backend-3",
  "region": "ap-southeast-1",
  "timestamp": "2026-10-11T09:47:00.000Z",
  "uptime": 120
}
```
> **Quy tắc Region linh hoạt**: Giá trị `region` được lấy động từ biến môi trường `AWS_REGION` hoặc `REGION`. Nếu không cấu hình, giá trị trả về là `"unknown"`. Tuyệt đối không fallback cứng thành `"ap-southeast-1"` để tránh tình trạng Pod chạy tại Tokyo nhưng báo sai vùng hoạt động.

---

## 5. Kiến Trúc Pipeline CI/CD

```text
git push / pull request
         │
         ▼
[Job 1: detect-changes]
  - Kiểm tra tính toàn vẹn của bộ lọc (bash ci/test_detect_changes.sh)
  - Phân tích git diff (bash ci/detect_changes.sh changed-files.txt)
  - Sinh ma trận động (Ví dụ: ["backend-2"] hoặc ["frontend","backend-1","backend-2","backend-3"])
         │
         ▼
[Job 2: test-build-push (Chạy song song)]
  - Chạy unit tests component (bash ci/test_component.sh <path>)
  - Build Docker image từ root context (docker build -f <path>/Dockerfile .)
  - Quét an ninh container bằng Trivy
  - [Chỉ push main]: OIDC AssumeRole -> Login ECR -> Push ECR Singapore với tag <SHA> và main
         │
         ▼
[Job 3: gitops-update (Duy nhất 1 Job - Loại bỏ hoàn toàn Race Condition)]
  - Chạy sau khi toàn bộ matrix job hoàn tất thành công
  - Clone repo aws-multi-region-dr-platform
  - Cập nhật đúng các component bị ảnh hưởng trong kustomization.yaml
  - Tạo duy nhất 1 commit và 1 push sang nhánh main!
```

---

## 6. Danh Mục 11 Bài Thực Hành (Labs)

Toàn bộ hướng dẫn từng bước từ phát triển cục bộ, kết nối Aurora, đến CI/CD và GitOps:

1. [LAB 00 - Kiến Trúc Monorepo & Cấu Trúc Ứng Dụng](docs/labs/00-application-structure.md)
2. [LAB 01 - Chạy và Phát Triển Ứng Dụng Local](docs/labs/01-local-development.md)
3. [LAB 02 - Chiến Lược Kiểm Thử (Testing Contract)](docs/labs/02-testing.md)
4. [LAB 03 - Đóng Gói Container với Docker (Docker Build)](docs/labs/03-docker-build.md)
5. [LAB 04 - Cơ Chế Phát Hiện Thay Đổi (Change Detection)](docs/labs/04-change-detection.md)
6. [LAB 05 - Thiết Kế Pipeline CI với GitHub Actions](docs/labs/05-github-actions-ci.md)
7. [LAB 06 - Xác Thực Không Dùng Khóa với GitHub OIDC & AWS IAM](docs/labs/06-github-oidc-aws.md)
8. [LAB 07 - Đẩy Container Image Lên Amazon ECR](docs/labs/07-ecr-push.md)
9. [LAB 08 - Sao Chép Image Đa Vùng (ECR Cross-Region Replication)](docs/labs/08-ecr-multi-region.md)
10. [LAB 09 - Bàn Giao Triển Khai Cho GitOps (GitOps Handoff)](docs/labs/09-gitops-handoff.md)
11. [LAB 10 - Kiểm Chứng Toàn Diện CI/CD & Khắc Phục Sự Cố](docs/labs/10-cicd-validation.md)

---

## 7. Khởi Chạy Nhanh Cục Bộ (Quick Start)

```bash
# 1. Chạy toàn bộ unit tests (23 tests)
bash ci/test_component.sh frontend
bash ci/test_component.sh services/backend-1
bash ci/test_component.sh services/backend-2
bash ci/test_component.sh services/backend-3
bash ci/test_component.sh shared
bash ci/test_detect_changes.sh

# 2. Đóng gói 4 Docker images
docker build -f frontend/Dockerfile -t local/app2-frontend:test .
docker build -f services/backend-1/Dockerfile -t local/app2-backend-1:test .
docker build -f services/backend-2/Dockerfile -t local/app2-backend-2:test .
docker build -f services/backend-3/Dockerfile -t local/app2-backend-3:test .
```
