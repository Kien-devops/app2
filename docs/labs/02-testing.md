# LAB 02 - Chiến Lược Kiểm Thử (Testing Contract)

## Goal
Hiểu và áp dụng Testing Contract thống nhất cho toàn bộ Monorepo. Nắm rõ cách thức hoạt động của `ci/test.sh` trong từng component, script điều phối `ci/test_component.sh`, kiến trúc mock Database Adapter trong `backend-3`, và test suite kiểm tra bộ lọc thay đổi `ci/test_detect_changes.sh`.

## Prerequisites
- Đã hoàn thành [LAB 01](01-local-development.md).
- Hiểu nguyên lý Test Automation & Unit Testing không phụ thuộc hạ tầng ngoài.

## Files involved
- `ci/test_component.sh` (Monorepo generic test dispatcher)
- `ci/test_detect_changes.sh` (Test suite cho Change Detection)
- `frontend/ci/test.sh` & `frontend/tests/frontend.test.js` (3 tests)
- `services/backend-1/ci/test.sh` & `services/backend-1/tests/backend-1.test.js` (3 tests)
- `services/backend-2/ci/test.sh` & `services/backend-2/tests/backend-2.test.js` (4 tests)
- `services/backend-3/ci/test.sh` & `services/backend-3/tests/backend-3.test.js` (9 tests)
- `shared/ci/test.sh` & `shared/tests/health.test.js` (4 tests)

## Step-by-step

### 1. Khái niệm "Testing Contract"
Trong một Monorepo gồm nhiều dịch vụ khác nhau:
1. **Mỗi component bắt buộc có file thực thi**:
   `<component>/ci/test.sh`
2. **Interface gọi thống nhất từ CI**:
   ```bash
   bash ci/test_component.sh <relative_path_to_component>
   ```

### 2. Mock Database Adapter trong Backend-3
Một nguyên tắc cốt lõi của CI/CD hiện đại: **Unit tests trong CI không được phụ thuộc vào Aurora PostgreSQL thật đang chạy**.
- `services/backend-3/src/db.js` được thiết kế độc lập.
- `services/backend-3/src/app.js` cung cấp factory `createRequestHandler(dbAdapter)`.
- Trong `tests/backend-3.test.js`, một `MockDb` trong bộ nhớ được inject để kiểm tra:
  - Kiểm tra tính hợp lệ dữ liệu (validation `item_id`, `quantity`).
  - Hỗ trợ ghi chuỗi `marker` phục vụ đo RPO (`SEQ-000001`, `SEQ-000002`).
  - Xử lý lỗi kết nối DB: khi DB bị ngắt, service trả về HTTP 503 mà không crash process.

---

## Commands
Thực thi kiểm thử cho từng component và kiểm tra bộ lọc:

```bash
# 1. Chạy test toàn bộ 23 unit tests
bash ci/test_component.sh frontend
bash ci/test_component.sh services/backend-1
bash ci/test_component.sh services/backend-2
bash ci/test_component.sh services/backend-3
bash ci/test_component.sh shared

# 2. Chạy test suite kiểm tra bộ lọc thay đổi
bash ci/test_detect_changes.sh
```

## Expected output

```text
==> Running frontend tests...
ℹ tests 3, pass 3, fail 0
==> Running backend-1 tests...
ℹ tests 3, pass 3, fail 0
==> Running backend-2 tests...
ℹ tests 4, pass 4, fail 0
==> Running backend-3 tests...
✔ backend-3 getHealthStatus adheres to platform contract
✔ backend-3 handleRequest returns 200 on /health even without DB
✔ backend-3 handleRequest returns 200 on /api/v1/info
✔ backend-3 POST /api/v1/orders validates item_id
✔ backend-3 POST /api/v1/orders validates quantity (must be positive integer)
✔ backend-3 POST /api/v1/orders successfully creates order with 201
✔ backend-3 supports RPO sequence marker in POST /api/v1/orders
✔ backend-3 returns 503 on POST /api/v1/orders when DB is unavailable
✔ backend-3 returns 503 on GET /api/v1/orders when DB is unavailable without crashing
ℹ tests 9, pass 9, fail 0
==> Running shared component tests...
ℹ tests 4, pass 4, fail 0
==> Running change detection unit tests...
  [PASS] Backend-2 change => ["backend-2"]
  [PASS] Frontend change => ["frontend"]
  [PASS] Backend-1 change => ["backend-1"]
  [PASS] Backend-3 change => ["backend-3"]
  [PASS] Shared change triggers all 4 => ["frontend","backend-1","backend-2","backend-3"]
  [PASS] Docs change skips all => []
  [PASS] Root README change skips all => []
  [PASS] Docs + README change skips all => []
  [PASS] Multiple services (frontend + backend-3) => ["frontend","backend-3"]
==> Change detection test results: 9 passed, 0 failed.
```

Toàn bộ **23 unit tests** của các component cùng **9 test scenarios** của change detection đều vượt qua với exit code 0.

## Verification
- Xác nhận tốc độ chạy cực nhanh: Toàn bộ test hoàn thành chỉ trong chưa đầy 2 giây.
- Đảm bảo không có bất kỳ lệnh gọi mạng ra ngoài nào bị chặn lại khi chạy offline.

## Security note
- Mọi logic xác thực đầu vào (`item_id` kiểu string, `quantity` là số nguyên dương) được kiểm thử kỹ càng để ngăn ngừa lỗi SQL Injection hoặc tràn số.

## Next step
Chuyển sang [LAB 03 - Đóng Gói Container với Docker (Docker Build)](03-docker-build.md) để tìm hiểu kỹ thuật build từ repository root context.
