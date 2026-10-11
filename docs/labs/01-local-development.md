# LAB 01 - Chạy và Phát Triển Ứng Dụng Local

## Goal
Hướng dẫn lập trình viên khởi chạy từng microservice cục bộ trên máy tính cá nhân, kiểm tra giao diện frontend, gọi các endpoint nghiệp vụ `/api/v1/catalog`, `/api/v1/orders`, và hiểu cách cấu hình biến môi trường vùng (`AWS_REGION`) cũng như kết nối PostgreSQL cho `backend-3`.

## Prerequisites
- Node.js version 18 trở lên (kiểm tra bằng `node -v`).
- `curl` hoặc Postman / trình duyệt web.

## Files involved
- `frontend/src/server.js` (Port: 3000)
- `services/backend-1/src/server.js` (Port: 8081)
- `services/backend-2/src/server.js` (Port: 8082)
- `services/backend-3/src/server.js` (Port: 8083) & `services/backend-3/src/db.js`

## Step-by-step

### 1. Bảng Phân Bổ Port & Endpoints Thống Nhất

| Component | Port | Endpoints Hỗ Trợ | Vai Trò Chính |
|---|:---:|---|---|
| **frontend** | `3000` | `GET /`<br>`GET /health` | Giao diện Dashboard & Điều hướng người dùng |
| **backend-1** | `8081` | `GET /health`<br>`GET /api/v1/info` | Authentication & Metadata Service |
| **backend-2** | `8082` | `GET /health`<br>`GET /api/v1/catalog`<br>`GET /api/v1/info` | Catalog & Inventory Read Service |
| **backend-3** | `8083` | `GET /health`<br>`GET /api/v1/info`<br>`GET /api/v1/orders`<br>`POST /api/v1/orders` | Orders Processing Service (Kết nối Aurora PostgreSQL) |

---

### 2. Khởi Chạy Từng Service Cục Bộ

#### Khởi chạy Backend-1:
```bash
cd services/backend-1
node src/server.js
# Output: [backend-1] Microservice listening on http://0.0.0.0:8081
```

#### Khởi chạy Backend-2:
```bash
cd services/backend-2
node src/server.js
# Output: [backend-2] Microservice listening on http://0.0.0.0:8082
```

#### Khởi chạy Backend-3:
`backend-3` hỗ trợ chạy cả khi có DB hoặc chưa có DB (offline mode):
- Khi không có `DB_HOST`: Service vẫn khởi động bình thường, endpoint `/health` và `/api/v1/info` trả về `200 OK`. Khi gọi `/api/v1/orders`, service trả về `503 Service Unavailable` một cách an toàn mà không crash Node process.
- Khi có PostgreSQL (local Docker hoặc Aurora):
```bash
cd services/backend-3
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_USER="postgres"
export DB_PASSWORD="password"
export DB_NAME="orders_db"
export DB_SSL="false"
node src/server.js
# Output: [backend-3] Microservice listening on http://0.0.0.0:8083
# Output: [backend-3/db] PostgreSQL database connected and table orders ensured.
```

#### Khởi chạy Frontend:
```bash
cd frontend
node src/server.js
# Output: [frontend] Server listening on http://0.0.0.0:3000
```

---

### 3. Quy Tắc Phân Giải Vùng Hoạt Động (Dynamic Region Resolution)

Tất cả các service không bao giờ fallback cứng về `"ap-southeast-1"`.
- Nếu có `AWS_REGION` hoặc `REGION`: trả về giá trị biến đó (ví dụ `"ap-southeast-1"` hoặc `"ap-northeast-1"`).
- Nếu thiếu cả 2 biến môi trường: trả về `"unknown"`.

Thử nghiệm:
```bash
# Mô phỏng Pod tại Tokyo:
AWS_REGION=ap-northeast-1 node services/backend-2/src/server.js

# Kiểm tra phản hồi:
curl -s http://localhost:8082/health
# Kết quả: {"status":"ok","service":"backend-2","region":"ap-northeast-1",...}
```

---

## Commands
Kiểm tra toàn bộ các API bằng `curl`:

```bash
# 1. Frontend
curl -s http://localhost:3000/health
curl -s http://localhost:3000/

# 2. Backend-1
curl -s http://localhost:8081/health
curl -s http://localhost:8081/api/v1/info

# 3. Backend-2
curl -s http://localhost:8082/health
curl -s http://localhost:8082/api/v1/catalog
curl -s http://localhost:8082/api/v1/info

# 4. Backend-3
curl -s http://localhost:8083/health
curl -s http://localhost:8083/api/v1/info

# 5. Gửi đơn hàng thử nghiệm vào Backend-3
curl -X POST http://localhost:8083/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"item_id":"item-001","quantity":2,"marker":"RPO_TEST_001"}'

# 6. Đọc danh sách đơn hàng theo marker
curl -s "http://localhost:8083/api/v1/orders?marker=RPO_TEST_001"
```

## Expected output

### Phản hồi từ `/api/v1/catalog` (Backend-2):
```json
[
  {
    "id": "item-001",
    "name": "Cloud Server Instance",
    "category": "compute",
    "price": 49.99,
    "stock": 100
  },
  {
    "id": "item-002",
    "name": "Global Aurora DB Replica",
    "category": "database",
    "price": 199.99,
    "stock": 50
  }
]
```

### Phản hồi từ `POST /api/v1/orders` (Backend-3 có DB):
```json
{
  "id": 1,
  "item_id": "item-001",
  "quantity": 2,
  "marker": "RPO_TEST_001",
  "created_at": "2026-10-11T09:48:00.000Z"
}
```

## Verification
- Xác nhận tất cả port dịch vụ khớp với hợp đồng (3000, 8081, 8082, 8083).
- Xác nhận `/health` luôn trả HTTP 200 kèm `region` chính xác.

## Troubleshooting
- **Lỗi `Database unavailable` (HTTP 503) trên `backend-3`**:
  - **Nguyên nhân**: Biến `DB_HOST` chưa được cấu hình hoặc container PostgreSQL chưa chạy.
  - **Khắc phục**: Đây là hành vi mong muốn bảo vệ tiến trình. Để chạy với DB thật, khởi động PostgreSQL container cục bộ bằng:
    `docker run -d --name local-pg -p 5432:5432 -e POSTGRES_PASSWORD=password -e POSTGRES_DB=orders_db postgres:16-alpine`.

## Security note
- Mật khẩu cơ sở dữ liệu `DB_PASSWORD` phải luôn được nạp thông qua biến môi trường hoặc AWS Secrets Manager, tuyệt đối không hardcode trong mã nguồn.

## Next step
Chuyển sang [LAB 02 - Chiến Lược Kiểm Thử (Testing Contract)](02-testing.md) để tìm hiểu bộ unit tests 23 kịch bản của Monorepo.
