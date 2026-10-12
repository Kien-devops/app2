# LAB 09 - Bàn Giao Triển Khai Cho GitOps (GitOps Handoff)

## Goal
Hiểu rõ ranh giới kiến trúc an toàn giữa Application CI và Infrastructure GitOps. Nắm vững lý do tại sao CI của repo `app2` **không bao giờ chạy `kubectl apply` trực tiếp**, và thực hành chi tiết **Kiến trúc Job Đơn Nhiệm `gitops-update`**: gom toàn bộ kết quả của các matrix build jobs, clone repo `aws-multi-region-dr-platform`, cập nhật chính xác các image tags trong Kustomize và tạo **duy nhất 1 commit & 1 push**, loại bỏ hoàn toàn race condition.

## Prerequisites
- Đã hoàn thành [LAB 07](07-ecr-push.md) và [LAB 08](08-ecr-multi-region.md).
- Tài khoản GitHub có quyền truy cập vào cả 2 repository: `Kien-devops/app2` và `Kien-devops/aws-multi-region-dr-platform`.

## Files involved
- `app2/.github/workflows/ci.yml` (Job `gitops-update`)
- `aws-multi-region-dr-platform/gitops/app2/base/kustomization.yaml` (File manifest Kubernetes đích)

## Step-by-step

### 1. Tại sao CI KHÔNG ĐƯỢC chạy `kubectl apply` trực tiếp?
Trong kiến trúc DevOps truyền thống kiểu "Push-based Deployment":
- Pipeline CI nắm giữ chứng chỉ cluster admin (`kubeconfig`), kết nối thẳng vào Kubernetes API Server và chạy `kubectl apply`.
- **Hiểm họa an ninh lớn**:
  1. **Rò rỉ toàn bộ Cluster**: Nếu pipeline CI bị xâm nhập (thông qua mã độc trong dependency), kẻ tấn công sẽ chiếm toàn quyền điều khiển cluster Kubernetes.
  2. **Xung đột cấu hình (Configuration Drift)**: Nếu ai đó chỉnh sửa cấu hình trực tiếp trên cluster, `kubectl` không có cơ chế phát hiện và đồng bộ ngược về Git.
  3. **Không có lịch sử kiểm toán thống nhất**: Không biết được phiên bản nào đang thực sự chạy trên cluster nếu ai đó bỏ qua CI.

### 2. Kiến Trúc Handoff Đơn Nhiệm (Single GitOps Update Job)
Nhiều pipeline Monorepo để mỗi matrix job tự push GitOps, gây `non-fast-forward`. Pipeline này dùng một job và `concurrency` để tuần tự hóa handoff.

Pipeline của `app2` giải quyết triệt để vấn đề này bằng kiến trúc **Single Job Handoff**:

```text
[ Job 1: detect-changes ]
           │
           ▼
[ Job 2: test-build-push (Parallel Matrix Jobs) ]
  ├── frontend build & push ECR
  ├── backend-1 build & push ECR
  ├── backend-2 build & push ECR
  └── backend-3 build & push ECR
  └── file-service build & push ECR (EC2 artifact)
           │
           │ (Chờ tất cả matrix jobs hoàn tất thành công)
           ▼
[ Job 3: gitops-update (Duy nhất 1 Runner) ]
  ├── Nhận danh sách components từ detect-changes
  ├── Lọc file-service vì workload này chạy trên EC2, không phải EKS
  ├── Clone repo "aws-multi-region-dr-platform"
  ├── Cập nhật đúng các thẻ image trong kustomization.yaml
  └── Thực hiện DUY NHẤT 1 commit & 1 push lên main! (Zero Race Condition)
```

---

### 3. Cấu Hình Job `gitops-update` Trong Workflow CI

```yaml
  gitops-update:
    name: GitOps Handoff (Single Commit & Push)
    needs: [detect-changes, test-build-push]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.detect-changes.outputs.has_changes == 'true'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application repository
        uses: actions/checkout@v4

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_GITHUB_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION || 'ap-southeast-1' }}

      - name: Resolve ECR Registry
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Update GitOps Repository Manifests
        shell: bash
        env:
          GITOPS_REPO: ${{ vars.GITOPS_REPO || 'Kien-devops/aws-multi-region-dr-platform' }}
          GITOPS_TOKEN: ${{ secrets.GITOPS_GITHUB_TOKEN }}
          REGISTRY: ${{ steps.ecr.outputs.registry }}
          NEW_TAG: ${{ github.sha }}
          COMPONENTS_JSON: ${{ needs.detect-changes.outputs.matrix }}
        run: |
          if [[ -z "${GITOPS_TOKEN:-}" ]]; then
            echo "::warning::GITOPS_GITHUB_TOKEN secret is not configured. Skipping GitOps handoff."
            exit 0
          fi

          echo "==> Initiating single-job GitOps handoff for components: $COMPONENTS_JSON"
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

          # Clone infra repository securely
          git clone "https://x-access-token:${GITOPS_TOKEN}@github.com/${GITOPS_REPO}.git" gitops-repo
          cd gitops-repo/gitops/app2/base

          # Cập nhật chính xác từng component trong kustomization.yaml bằng Node parser
          # ...
          git add -A
          git commit -m "ci: bump [${COMPONENTS_LIST}] image tags to ${NEW_TAG} [skip ci]"
          git push origin main
```

---

### 4. Quy Tắc Cập Nhật Chính Xác Kustomize (Targeting Exact Image Name)

Không bao giờ sử dụng câu lệnh `sed` thay thế hàng loạt kiểu `s/newTag:.*/newTag: SHA/` vì nó sẽ vô tình ghi đè toàn bộ các image tag khác trong manifest.
Script cập nhật của `app2` đọc mảng JSON các component bị thay đổi và chỉ tìm đúng khối:
```yaml
images:
  - name: <REGISTRY>/app2-backend-2
    newTag: <SHA_MỚI>
```
Những component không thay đổi sẽ được giữ nguyên tag hiện tại, đảm bảo tính nguyên vẹn tuyệt đối của hệ thống GitOps.

`file-service` chỉ được test/build/scan/push ECR. Job handoff bị skip khi đây là component duy nhất thay đổi; không tạo Kustomize entry giả. Push collision được retry tối đa 5 lần và job fail rõ nếu mọi lần đều thất bại.

---

### 5. Hướng Dẫn Thiết Lập Fine-Grained Token Trên GitHub

1. Truy cập GitHub cá nhân -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Fine-grained tokens**.
2. Bấm **Generate new token**:
   - **Token name**: `app2-ci-gitops-handoff`
   - **Repository access**: Chọn **Only select repositories** -> Chọn đúng repo:
     ```text
     Kien-devops/aws-multi-region-dr-platform
     ```
   - **Permissions**:
     - **Repository permissions**: Tìm **Contents** -> Chọn `Access: Read and write`.
3. Bấm **Generate token** và copy chuỗi token (dạng `github_pat_...`).
4. Truy cập repository **`Kien-devops/app2`**:
   - Vào **Settings** -> **Secrets and variables** -> **Actions**.
   - Bấm **New repository secret**:
     - **Name**: `GITOPS_GITHUB_TOKEN`
     - **Secret**: Dán token vừa copy.
5. Bấm **Add secret**.

## Expected output
Khi job `gitops-update` hoàn thành:
```text
==> Initiating single-job GitOps handoff for components: ["backend-2"]
==> Working in manifest directory: gitops/app2/base
Updating image tag for app2-backend-2 to 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1f
kustomization.yaml updated successfully.
[main a1b2c3d] ci: bump [backend-2] image tags to 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1f [skip ci]
 1 file changed, 1 insertion(+), 1 deletion(-)
==> Successfully pushed GitOps tag update (1 commit) to Kien-devops/aws-multi-region-dr-platform.
```

## Security note
- Không leak token trong console logs hoặc URL git remote.
- Gắn thẻ commit `[skip ci]` để tránh gây vòng lặp kích hoạt không cần thiết trên repo hạ tầng.

## Next step
Chuyển sang [LAB 10 - Kiểm Chứng Toàn Diện CI/CD (CI/CD Validation Scenarios)](10-cicd-validation.md) để kiểm chứng cả 5 kịch bản CI/CD trên thực tế.
