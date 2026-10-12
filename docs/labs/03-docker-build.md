# LAB 03 - Đóng Gói Container với Docker (Docker Build)

## Goal
Nắm vững các nguyên tắc xây dựng Dockerfile tiêu chuẩn sản xuất (production-friendly) cho các microservice trong `app2`. Thực hành lệnh `docker build` từ repository root context, kiểm tra cài đặt thư viện `pg` thật cho `backend-3`, kiểm tra quyền non-root user, và gọi endpoint `/health` từ bên trong container.

## Prerequisites
- Đã cài đặt Docker Engine / Docker Desktop (kiểm tra bằng `docker --version`).
- Đã hoàn thành [LAB 01](01-local-development.md) và [LAB 02](02-testing.md).

## Files involved
- `frontend/Dockerfile` & `frontend/.dockerignore`
- `services/backend-1/Dockerfile` & `services/backend-1/.dockerignore`
- `services/backend-2/Dockerfile` & `services/backend-2/.dockerignore`
- `services/backend-3/Dockerfile` & `services/backend-3/.dockerignore`
- `services/file-service/Dockerfile` & `services/file-service/.dockerignore`
- `.dockerignore` (Bộ lọc toàn cục tại repo root)

## Step-by-step

### 1. Tại sao cần Build từ Root Context (`.`)?
Vì cả 5 deployable components tái sử dụng contract từ `shared/src/health.js`:
- Nếu build từ thư mục con `services/backend-1/`, Docker daemon sẽ không thể truy cập các tệp nằm ngoài thư mục đó (`../shared`).
- **Giải pháp chuẩn chuẩn mực (Option A)**:
  Đặt context là gốc Monorepo (`.`) và chỉ định đường dẫn Dockerfile qua cờ `-f`:
  ```bash
  docker build -f services/backend-3/Dockerfile -t local/app2-backend-3:test .
  docker build -f services/file-service/Dockerfile -t local/app2-file-service:test .
  ```
  Dockerfile copy cả `shared/` và `services/backend-3/`, giúp cấu trúc relative path `../../../shared/src/health` hoạt động đồng nhất 100% cả ở máy phát triển lẫn bên trong container.

### 2. Cài Đặt Dependency Thực Tế (`npm ci --omit=dev`)
Khác với các microservice tĩnh, `backend-3` sử dụng thư viện kết nối PostgreSQL (`pg`):
- Dockerfile copy `package*.json` trước.
- Chạy lệnh `npm ci --omit=dev` để cài đặt thư viện vào `node_modules` bên trong container image.
- Thực thi `chown -R node:node /app` và chuyển sang `USER node` để đảm bảo an ninh.

### 3. Bảng Cấu Hình Healthcheck Của Từng Container

| Service | Port Lắng Nghe | Lệnh HEALTHCHECK Trong Dockerfile |
|---|:---:|---|
| **frontend** | `3000` | `CMD wget -qO- http://127.0.0.1:3000/health \|\| exit 1` |
| **backend-1** | `8081` | `CMD wget -qO- http://127.0.0.1:8081/health \|\| exit 1` |
| **backend-2** | `8082` | `CMD wget -qO- http://127.0.0.1:8082/health \|\| exit 1` |
| **backend-3** | `8083` | `CMD wget -qO- http://127.0.0.1:8083/health \|\| exit 1` |
| **file-service** | `8084` | `CMD wget -qO- http://127.0.0.1:8084/health \|\| exit 1` |

---

## Commands

```bash
# 1. Đóng gói cả 5 container images từ repository root
docker build -f frontend/Dockerfile -t local/app2-frontend:test .
docker build -f services/backend-1/Dockerfile -t local/app2-backend-1:test .
docker build -f services/backend-2/Dockerfile -t local/app2-backend-2:test .
docker build -f services/backend-3/Dockerfile -t local/app2-backend-3:test .
docker build -f services/file-service/Dockerfile -t local/app2-file-service:test .

# 2. Khởi chạy các container cần kiểm tra
docker run -d --name c-fe -p 3000:3000 -e AWS_REGION=ap-southeast-1 local/app2-frontend:test
docker run -d --name c-b1 -p 8081:8081 -e AWS_REGION=ap-southeast-1 local/app2-backend-1:test
docker run -d --name c-b2 -p 8082:8082 -e AWS_REGION=ap-southeast-1 local/app2-backend-2:test
docker run -d --name c-b3 -p 8083:8083 -e AWS_REGION=ap-southeast-1 local/app2-backend-3:test
docker run -d --name c-files -p 8084:8084 -e AWS_REGION=ap-southeast-1 -e STORAGE_PATH=/mnt/dr-data -v /mnt/dr-data:/mnt/dr-data local/app2-file-service:test

# 3. Kiểm tra health endpoints của từng container
curl -s http://localhost:3000/health
curl -s http://localhost:8081/health
curl -s http://localhost:8082/health
curl -s http://localhost:8083/health

# 4. Kiểm tra catalog endpoint từ container backend-2
curl -s http://localhost:8082/api/v1/catalog

# 5. Kiểm tra quyền non-root (UID 1000)
docker exec c-b3 whoami
docker exec c-b3 id

# 6. Dọn dẹp containers
docker stop c-fe c-b1 c-b2 c-b3
docker rm c-fe c-b1 c-b2 c-b3
```

## Expected output

### Phản hồi từ `docker exec c-b3 id`:
```text
uid=1000(node) gid=1000(node) groups=1000(node)
```

### Phản hồi từ `curl -s http://localhost:8083/health`:
```json
{
  "status": "ok",
  "service": "backend-3",
  "region": "ap-southeast-1",
  "timestamp": "2026-10-11T09:47:00.000Z",
  "uptime": 3
}
```

## Verification
- Xác nhận dung lượng các image:
  `app2-frontend`, `app2-backend-1`, `app2-backend-2` xấp xỉ ~150MB.
  `app2-backend-3` (kèm `pg` và `node_modules`) xấp xỉ ~170MB.
- Toàn bộ container ở trạng thái `Up (healthy)`.

## Security note
- Tuyệt đối không để sót file credentials, SSH key hoặc file `.env` khi chạy lệnh build context. File `.dockerignore` tại gốc repository đã loại trừ toàn bộ các thư mục nhạy cảm.

## Next step
Chuyển sang [LAB 04 - Cơ Chế Phát Hiện Thay Đổi (Change Detection)](04-change-detection.md) để tìm hiểu cách thức phân tích git diff.
