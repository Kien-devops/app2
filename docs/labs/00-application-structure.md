# LAB 00 - Kiến Trúc Monorepo & Cấu Trúc Ứng Dụng app2

## Goal
Hiểu rõ kiến trúc tổng thể của monorepo `app2`, ranh giới trách nhiệm giữa các service (`frontend`, `backend-1`, `backend-2`, `backend-3`, `shared`), vai trò kết nối cơ sở dữ liệu **Amazon Aurora PostgreSQL Global Database**, và mối liên hệ với hạ tầng GitOps đa vùng (`aws-multi-region-dr-platform`).

## Prerequisites
- Đã cài đặt Git, Node.js (>= 18) và Docker Desktop.
- Hiểu khái niệm Microservices, Monorepo và cơ chế kết nối Database Connection Pool.
- Hiểu kiến trúc Active-Passive / Multi-Region Disaster Recovery (DR).

## Files involved
- `frontend/` (Web UI & Client Gateway - Port 3000)
- `services/backend-1/` (Authentication & Demo Service - Port 8081)
- `services/backend-2/` (Catalog & Inventory Read Service - Port 8082)
- `services/backend-3/` (Orders Processing Service kết nối PostgreSQL Aurora - Port 8083)
- `shared/` (Shared contracts, dynamic region resolution & health helper)
- `ci/` (Change detection & test runners)
- `.github/workflows/ci.yml` (GitHub Actions CI/CD Pipeline 3-job)

## Step-by-step

### 1. Phân định trách nhiệm giữa 2 Repository
Hệ thống demo Disaster Recovery gồm 2 repository tách biệt hoàn toàn theo nguyên lý Separation of Concerns:
1. **`app2` (Application Monorepo - Repo hiện tại)**:
   - Chứa mã nguồn ứng dụng (1 frontend + 3 backends + shared).
   - `backend-3` kết nối trực tiếp PostgreSQL để phục vụ ghi dữ liệu và đo đạc RPO thực tế.
   - Đảm nhiệm CI: lint, unit test, build container image từ root context, quét bảo mật Trivy, push image lên Amazon ECR Singapore (`ap-southeast-1`), và kích hoạt job `gitops-update` duy nhất để cập nhật tag sang repo hạ tầng.
   - **Tuyệt đối không chứa cluster credentials, không chạy `kubectl apply` trực tiếp**.
2. **`aws-multi-region-dr-platform` (Infrastructure & GitOps Repo)**:
   - Chứa Terraform / OpenTofu cấu hình hạ tầng AWS (VPC, EKS, ECR, Route 53, Aurora Global Database).
   - Chứa manifests GitOps (Argo CD Application, Helm charts, Kustomize overlays cho `ap-southeast-1` và `ap-northeast-1`).
   - Lắng nghe cập nhật image tag mới từ ECR để đồng bộ sang cụm EKS.

```text
+-------------------------------------------------------------------------------+
|                           Application Monorepo (app2)                         |
|  [frontend:3000]   [backend-1:8081]   [backend-2:8082]   [backend-3:8083]     |
|                                                                 │ (pg Pool)   |
|                                                                 ▼             |
|                                                      [Aurora Global DB]       |
+---------------------------------------+---------------------------------------+
                                        │ (CI: Test, Build, Trivy)
                                        ▼
                        Amazon ECR (ap-southeast-1: Singapore)
                                        │
                 (AWS Cross-Region Replication - Tự động đồng bộ)
                                        ▼
                        Amazon ECR (ap-northeast-1: Tokyo)
                                        │
+---------------------------------------+---------------------------------------+
|              Infrastructure & GitOps (aws-multi-region-dr-platform)           |
|         Argo CD (Singapore)                           Argo CD (Tokyo)         |
|                  │                                           │                |
|                  ▼                                           ▼                |
|         EKS Primary Cluster                         EKS Standby Cluster       |
+-------------------------------------------------------------------------------+
```

### 2. Cấu trúc thư mục chi tiết

```text
app2/
├── frontend/                     # Dịch vụ giao diện người dùng (Port 3000)
│   ├── src/
│   │   ├── app.js               # Logic điều hướng và health response
│   │   └── server.js            # Node.js HTTP server
│   ├── tests/
│   │   └── frontend.test.js     # Kiểm thử đơn vị frontend
│   ├── ci/
│   │   └── test.sh
│   ├── .dockerignore
│   ├── Dockerfile               # Production container (Context root)
│   └── package.json
│
├── services/
│   ├── backend-1/               # Service 1: Auth & Demo Service (Port 8081)
│   │   ├── src/
│   │   │   ├── app.js
│   │   │   └── server.js
│   │   ├── tests/
│   │   │   └── backend-1.test.js
│   │   ├── ci/
│   │   │   └── test.sh
│   │   ├── .dockerignore
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── backend-2/               # Service 2: Catalog & Inventory Service (Port 8082)
│   │   ├── src/
│   │   │   ├── app.js           # Endpoint /api/v1/catalog
│   │   │   └── server.js
│   │   ├── tests/
│   │   │   └── backend-2.test.js
│   │   ├── ci/
│   │   │   └── test.sh
│   │   ├── .dockerignore
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── backend-3/               # Service 3: Orders Service PostgreSQL (Port 8083)
│       ├── src/
│       │   ├── app.js           # Endpoint /api/v1/orders (GET & POST)
│       │   ├── db.js            # Module PostgreSQL Pool, Table init & Mockable adapter
│       │   └── server.js
│       ├── tests/
│       │   └── backend-3.test.js # Unit test validation, RPO sequences & DB error handling
│       ├── ci/
│       │   └── test.sh
│       ├── .dockerignore
│       ├── Dockerfile           # Đóng gói kèm dependencies pg thật
│       ├── package.json         # Dependency: "pg"
│       └── package-lock.json
│
├── shared/                      # Thư viện dùng chung giữa các services
│   ├── src/
│   │   └── health.js            # Dynamic Region Resolution Contract (AWS_REGION/REGION)
│   ├── tests/
│   │   └── health.test.js
│   ├── ci/
│   │   └── test.sh
│   └── package.json
│
├── ci/                          # Scripts CI dùng cho toàn bộ Monorepo
│   ├── detect_changes.sh        # Phân tích git diff và trả về matrix JSON
│   ├── test_detect_changes.sh   # Unit tests kiểm tra 9 kịch bản thay đổi đường dẫn
│   └── test_component.sh        # Runner thống nhất cho từng component
│
├── .dockerignore                # Loại trừ tài liệu, tests, .git khi build từ root context
├── docs/labs/                   # Bộ 11 tài liệu hướng dẫn thực hành chi tiết
└── .github/
    └── workflows/
        └── ci.yml               # Workflow 3-Job: detect -> matrix build -> single gitops update
```

## Commands
Khám phá cấu trúc thư mục bằng terminal:

```bash
# Kiểm tra trạng thái mã nguồn
git status

# Kiểm tra các component có sẵn
ls -la frontend services/ shared/ ci/
```

## Expected output
Tất cả 4 component (`frontend`, `backend-1`, `backend-2`, `backend-3`) cùng thư viện `shared` đều có cấu trúc nhất quán gồm `src/`, `tests/`, `ci/test.sh`, `package.json`, và `Dockerfile` (đối với 4 deployable components). `backend-3` có thêm `src/db.js` và dependency `pg`.

## Verification
1. Kiểm tra mỗi component đều chứa `ci/test.sh`:
   ```bash
   test -f frontend/ci/test.sh && echo "Frontend OK"
   test -f services/backend-1/ci/test.sh && echo "Backend-1 OK"
   test -f services/backend-2/ci/test.sh && echo "Backend-2 OK"
   test -f services/backend-3/ci/test.sh && echo "Backend-3 OK"
   test -f shared/ci/test.sh && echo "Shared OK"
   ```
2. Chạy test toàn bộ components:
   ```bash
   bash ci/test_component.sh frontend
   bash ci/test_component.sh services/backend-1
   bash ci/test_component.sh services/backend-2
   bash ci/test_component.sh services/backend-3
   bash ci/test_component.sh shared
   bash ci/test_detect_changes.sh
   ```

## Troubleshooting
- **Hiện tượng**: `shared/` có Dockerfile không?
  - **Giải thích**: `shared/` là thư viện mã nguồn và contract, **không phải** deployable microservice, nên không có Dockerfile. Thay đổi ở `shared/` sẽ kích hoạt build cho cả 4 microservices.
- **Hiện tượng**: `backend-3` có cần database đang chạy để test không?
  - **Giải thích**: `backend-3/src/db.js` được thiết kế dạng module hóa có thể mock trong unit test, cho phép CI chạy 100% độc lập mà không cần kết nối tới database thật.

## Security note
- Tuyệt đối không commit file `.env`, file private key SSH, hoặc AWS credentials vào repository.
- File `.dockerignore` đã được cấu hình chặt chẽ để ngăn chặn việc copy nhầm các file nhạy cảm vào container image.

## Next step
Chuyển sang [LAB 01 - Chạy và Phát Triển Ứng Dụng Local](01-local-development.md) để khởi chạy từng service trên máy phát triển và kiểm tra các endpoint nghiệp vụ.
