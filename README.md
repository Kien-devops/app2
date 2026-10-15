# app2 — Order Management

app2 là ứng dụng quản lý đơn hàng và danh mục sản phẩm, gồm giao diện web, các API dịch vụ và một file service độc lập. Mã nguồn được tổ chức theo monorepo để mỗi thành phần có thể kiểm thử, đóng gói và phát hành bằng image bất biến.

## Kiến trúc

```text
Client
  -> frontend (3000)
      -> backend-1 (system info, 8081)
      -> backend-2 (catalog, 8082)
      -> backend-3 (orders, 8083)
          -> PostgreSQL

file-service (8084) -> filesystem storage
```

| Thành phần | Vai trò | Cổng |
|---|---|---:|
| `frontend` | Home, System Info, Catalog, Orders, File Storage | 3000 |
| `backend-1` | System information API | 8081 |
| `backend-2` | Catalog API | 8082 |
| `backend-3` | Order API và persistence | 8083 |
| `file-service` | File upload, download, integrity, storage events | 8084 |

## API chính

- `GET /api/v1/info`
- `GET /api/v1/catalog`
- `GET /api/v1/orders`
- `POST /api/v1/orders` với `{ "item_id": "item-001", "quantity": 1 }`
- `GET /api/v1/orders/health`

Order records giữ trường `marker` tùy chọn để tương thích dữ liệu cũ; giao diện người dùng không yêu cầu trường này.

## Chạy local

Yêu cầu Node.js 20+.

```bash
npm test --prefix frontend
npm test --prefix services/backend-1
npm test --prefix services/backend-2
npm test --prefix services/backend-3
```

Chạy từng service:

```bash
node frontend/src/server.js
node services/backend-1/src/server.js
node services/backend-2/src/server.js
node services/backend-3/src/server.js
```

`backend-3` đọc cấu hình PostgreSQL từ `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` và `DB_SSL`. Không lưu credential trong source code.

## Container

Docker build dùng repository root làm context để dùng được mã dùng chung:

```bash
docker build -f frontend/Dockerfile -t app2-frontend:local .
docker build -f services/backend-1/Dockerfile -t app2-backend-1:local .
docker build -f services/backend-2/Dockerfile -t app2-backend-2:local .
docker build -f services/backend-3/Dockerfile -t app2-backend-3:local .
docker build -f services/file-service/Dockerfile -t app2-file-service:local .
```

## CI/CD

GitHub Actions thực hiện:

1. Phát hiện component thay đổi.
2. Chạy unit test, Docker build và Trivy scan.
3. Push image immutable theo Git SHA lên Amazon ECR Singapore khi push `main`.
4. Cập nhật image tag tương ứng trong repository GitOps.

AWS authentication dùng GitHub OIDC. Workflow không chứa cluster credentials và không chạy `kubectl apply`; deployment workload do Argo CD trong repository hạ tầng thực hiện.

## Repository boundaries

- Repository này: application source, tests, Dockerfiles và CI.
- `aws-multi-region-dr-platform`: AWS infrastructure, Kubernetes manifests và GitOps desired state.
- `file-service` là workload storage riêng, không nằm trong application routing của Kubernetes.
