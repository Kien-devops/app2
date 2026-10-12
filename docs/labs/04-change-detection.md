# LAB 04 - Cơ Chế Phát Hiện Thay Đổi (Change Detection)

## Goal
Hiểu sâu sắc cơ chế phát hiện thay đổi đường dẫn (Path-based Change Detection) trong Monorepo `app2`. Nắm rõ thuật toán phân tích file diff của `ci/detect_changes.sh`, cách sinh ma trận thực thi động (dynamic matrix) cho GitHub Actions, và bộ kiểm thử tự động `ci/test_detect_changes.sh`.

## Prerequisites
- Đã hoàn thành [LAB 00](00-application-structure.md) và [LAB 02](02-testing.md).
- Hiểu lệnh `git diff --name-only`.

## Files involved
- `ci/detect_changes.sh` (Shell script cốt lõi phát hiện thay đổi)
- `ci/test_detect_changes.sh` (Path detection và GitOps filtering tests)
- `.github/workflows/ci.yml` (Job `detect-changes`)

## Step-by-step

### 1. Tại sao Monorepo cần Change Detection?
- Trong một Monorepo: nếu chỉ thay đổi 1 dòng trong `frontend` hoặc sửa tài liệu `README.md` mà phải build và quét Trivy lại cả 3 backend thì sẽ lãng phí tài nguyên và kéo dài thời gian CI.
- **Giải pháp của app2**: Phân tích danh sách file thay đổi trong git commit/PR và chỉ đưa các component thực sự bị ảnh hưởng vào mảng thực thi.

### 2. Nguyên tắc phân loại đường dẫn (Path Matching Rules)

1. **Thay đổi trong `frontend/**`**:
   Chỉ `frontend` được test, build và push. Toàn bộ backend được bỏ qua.
2. **Thay đổi trong `services/<service-name>/**`**:
   Chỉ đúng service đó được đưa vào ma trận. Các service khác được bỏ qua.
3. **Thay đổi trong `shared/**`**:
   Vì `shared` là thư viện nền tảng, thay đổi `shared/**` đánh dấu cả 5 components, gồm `file-service`.
4. **Thay đổi trong `docs/**`, `README.md`, hoặc các file không liên quan**:
   Script trả về danh sách rỗng `[]`. CI kết thúc sớm và không build bất kỳ Docker image nào.

### 3. Bảng Ma Trận Trường Hợp Kiểm Thử (Test Case Table)

| STT | File thay đổi trong commit | frontend | backend-1 | backend-2 | backend-3 | JSON Output của script | Hành động CI |
|:---:|---|:---:|:---:|:---:|:---:|---|---|
| **1** | `frontend/src/app.js` | **RUN** | SKIP | SKIP | SKIP | `["frontend"]` | Test & build duy nhất frontend |
| **2** | `services/backend-2/src/app.js` | SKIP | SKIP | **RUN** | SKIP | `["backend-2"]` | Test & build duy nhất backend-2 |
| **3** | `services/backend-1/src/app.js` | SKIP | **RUN** | SKIP | SKIP | `["backend-1"]` | Test & build duy nhất backend-1 |
| **4** | `services/backend-3/src/db.js` | SKIP | SKIP | SKIP | **RUN** | `["backend-3"]` | Test & build duy nhất backend-3 |
| **5** | `services/file-service/src/storage.js` | SKIP | SKIP | SKIP | SKIP | `["file-service"]` | Test/build file-service; không sửa EKS GitOps |
| **6** | `shared/src/health.js` | **RUN** | **RUN** | **RUN** | **RUN** | `["frontend","backend-1","backend-2","backend-3","file-service"]` | Test & build toàn bộ 5 components |
| **6** | `docs/README.md` | SKIP | SKIP | SKIP | SKIP | `[]` | Không build container nào |
| **7** | `README.md` | SKIP | SKIP | SKIP | SKIP | `[]` | Không build container nào |
| **8** | `frontend/src/app.js` + `services/backend-3/src/app.js` | **RUN** | SKIP | SKIP | **RUN** | `["frontend","backend-3"]` | Test & build frontend và backend-3 song song |

---

## Commands
Thực thi kiểm tra bộ lọc thay đổi trực tiếp:

```bash
# 1. Chạy unit tests tự động của change detection
bash ci/test_detect_changes.sh

# 2. Thử nghiệm thủ công với file bất kỳ
echo "services/backend-3/src/db.js" > /tmp/sample_diff.txt
bash ci/detect_changes.sh /tmp/sample_diff.txt
```

## Expected output

```text
==> Running change detection unit tests...
  [PASS] Backend-2 change => ["backend-2"]
  [PASS] Frontend change => ["frontend"]
  [PASS] Backend-1 change => ["backend-1"]
  [PASS] Backend-3 change => ["backend-3"]
  [PASS] File-service change => ["file-service"]
  [PASS] Shared change triggers all 5 => ["frontend","backend-1","backend-2","backend-3","file-service"]
  [PASS] Docs change skips all => []
  [PASS] Root README change skips all => []
  [PASS] Docs + README change skips all => []
  [PASS] Multiple services (frontend + backend-3) => ["frontend","backend-3"]
  [PASS] Multiple services (frontend + file-service) => ["frontend","file-service"]
==> Change detection test results: 13 passed, 0 failed.
```

## Verification
- Xác nhận job đầu tiên `detect-changes` trong GitHub Actions luôn gọi `bash ci/test_detect_changes.sh` trước khi tính toán diff thật.
- Khi không có component nào thay đổi, cờ `has_changes=false` ngăn chặn toàn bộ các job build kế tiếp.

## Security note
- Phân tích diff bằng `git diff` an toàn và minh bạch, không phụ thuộc vào plugin bên ngoài có nguy cơ supply chain attack.

## Next step
Chuyển sang [LAB 05 - Thiết Kế Pipeline CI với GitHub Actions](05-github-actions-ci.md) để tìm hiểu kiến trúc pipeline 3-job.
