# LAB 11 - File Service và Filesystem DR Contract

## Goal

Chạy `file-service` cục bộ, kiểm tra upload/list/download/delete, SHA-256 và storage event. Lab này chỉ kiểm chứng application contract; không khẳng định FSx ONTAP hoặc SnapMirror đã được triển khai.

## Architecture

```text
Browser / DR writer
        |
        v
file-service:8084 (EC2 container)
        |
        v
STORAGE_PATH=/mnt/dr-data
        |
        v
FSx for NetApp ONTAP volume
        |
        v
SnapMirror asynchronous replication
```

`backend-3` và `file-service` không chia sẻ state:

- `backend-3` ghi transaction vào Aurora Global Database.
- `file-service` ghi file, metadata, checksum và DR marker vào filesystem.
- Database RPO và storage RPO phải được đo, báo cáo riêng.

## Local run

```bash
cd services/file-service
npm ci
AWS_REGION=ap-southeast-1 STORAGE_PATH=/tmp/app2-dr-data node src/server.js
```

Windows PowerShell:

```powershell
$env:AWS_REGION = 'ap-southeast-1'
$env:STORAGE_PATH = "$env:TEMP\app2-dr-data"
node services/file-service/src/server.js
```

Local fallback chỉ dùng khi `STORAGE_PATH` không được đặt. Production luôn truyền `/mnt/dr-data` từ bind mount FSx.

## API validation

```bash
curl -s http://localhost:8084/health
curl -s http://localhost:8084/ready

curl -s -X POST http://localhost:8084/api/v1/files \
  -F "file=@./network-report.pdf"

curl -s http://localhost:8084/api/v1/files
curl -s http://localhost:8084/api/v1/files/<FILE_ID>
curl -OJ http://localhost:8084/api/v1/files/<FILE_ID>/download
curl -s http://localhost:8084/api/v1/files/<FILE_ID>/verify
curl -i -X DELETE http://localhost:8084/api/v1/files/<FILE_ID>
```

Storage RPO marker:

```bash
curl -s -X POST http://localhost:8084/api/v1/storage/events \
  -H 'Content-Type: application/json' \
  -d '{"sequence":10001,"marker":"DR-SEQ-010001"}'

curl -s http://localhost:8084/api/v1/storage/events/latest
```

Filesystem layout:

```text
/mnt/dr-data/
├── uploads/<uuid>-<sanitized-name>
├── metadata/<uuid>.json
└── events/010001.json
```

## Frontend

`GET /files` gọi trực tiếp file-service. Nếu dùng ALB/hostname riêng:

```bash
FILE_SERVICE_BASE_URL=https://files.example.com \
  node frontend/src/server.js
```

File-service phải allow-list đúng frontend origin:

```bash
CORS_ALLOWED_ORIGINS=https://app.example.com
```

Không dùng `*` cho production CORS.

## Container

```bash
docker build -f services/file-service/Dockerfile -t local/app2-file-service:test .
docker run --rm -p 8084:8084 \
  -e AWS_REGION=ap-southeast-1 \
  -e STORAGE_PATH=/mnt/dr-data \
  -v /mnt/dr-data:/mnt/dr-data \
  local/app2-file-service:test
```

Production dùng immutable ECR tag `<commit-sha>`, không dùng `latest`. EC2 instance profile cung cấp quyền pull ECR; không đặt AWS access key trong container.

## Readiness and DR safety

- `/health`: process còn sống; không chứng minh filesystem writable.
- `/ready`: đọc path và tạo/xóa write probe.
- SnapMirror destination chưa break: expected `503`, `readable=true`, `writable=false`, `reason=filesystem_read_only`.
- Sau break/promote: expected `200`, `writable=true`.
- Service manager trên EC2 phải phụ thuộc mount `/mnt/dr-data` (`RequiresMountsFor=/mnt/dr-data` hoặc cơ chế tương đương). Nếu NFS chưa mount, không khởi động writer; tránh ghi nhầm vào EBS local.
- Trước planned switchover: dừng write Singapore, final update, xác nhận synchronized, quiesce/break đúng hướng, sau đó mới bật Tokyo writer. Không để hai volume cùng writable.

## Tests

```bash
bash ci/test_component.sh services/file-service
bash ci/test_detect_changes.sh
```

Test dùng temporary directory; không cần AWS, NFS hoặc FSx thật. Read-only behavior dùng adapter result để portable giữa Windows/Linux.

## Security

- Upload mặc định tối đa 10 MiB; thay bằng `MAX_UPLOAD_BYTES` khi cần.
- Client không được truyền filesystem path.
- Filename được lấy basename, sanitize, giới hạn độ dài; stored name luôn có UUID.
- File ID chỉ chấp nhận UUID v4.
- Checksum phát hiện integrity mismatch; checksum không phải authentication hay malware scanning.
- ALB là public entry. EC2 và FSx private; NFS chỉ mở từ security group EC2 được chỉ định.

## Evidence boundary

Các kết quả local chứng minh application contract. RPO/RTO, SnapMirror lag, failover/failback và integrity sau DR chỉ là `Measured Result` sau khi chạy trên AWS thật.
