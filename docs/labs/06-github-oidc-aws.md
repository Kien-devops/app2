# LAB 06 - Xác Thực Không Dùng Khóa với GitHub OIDC & AWS IAM

## Goal
Loại bỏ hoàn toàn rủi ro bảo mật của khóa tĩnh (`AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY`). Thiết lập cơ chế xác thực hiện đại dựa trên OpenID Connect (OIDC) giữa GitHub Actions và AWS Security Token Service (STS) để cấp phát thông tin đăng nhập tạm thời (temporary credentials) có thời hạn ngắn.

## Prerequisites
- Tài khoản AWS có quyền quản trị IAM (IAM Administrator).
- Repository GitHub `Kien-devops/app2` với quyền truy cập Settings (Repository Admin).
- Nắm rõ khái niệm Identity Federation và Trust Policy.

## Files involved
- `.github/workflows/ci.yml` (Step `Configure AWS credentials via OIDC`)

## Step-by-step

### 1. Tại sao KHÔNG BAO GIỜ sử dụng AWS Access Keys tĩnh trong CI/CD?
- **Rủi ro rò rỉ**: Access Keys có thể bị vô tình in ra console logs, bị commit vào mã nguồn, hoặc bị tấn công từ bên thứ ba.
- **Tuổi thọ không giới hạn**: Access Keys không tự hết hạn trừ khi được thu hồi thủ công.
- **Giải pháp OIDC (Keyless Authentication)**:
  1. GitHub Actions runner yêu cầu một mã thông báo OIDC (OIDC ID Token) dạng JSON Web Token (JWT) được ký điện tử bởi GitHub.
  2. Runner gửi JWT này sang AWS STS thông qua API `AssumeRoleWithWebIdentity`.
  3. AWS STS xác minh chữ ký điện tử và kiểm tra các điều kiện trong **Trust Policy** (đúng repo `Kien-devops/app2`, đúng nhánh `main`).
  4. Nếu hợp lệ, AWS STS trả về bộ credentials tạm thời (Access Key, Secret Key, Session Token) có thời hạn mặc định 1 giờ.

```text
+-----------------------+                    +-----------------------+
| GitHub Actions Runner |                    |  GitHub OIDC Provider |
+-----------+-----------+                    +-----------+-----------+
            |                                            |
            | 1. Request OIDC Token (JWT)                |
            |------------------------------------------->|
            | 2. Return signed JWT                       |
            |<-------------------------------------------|
            |
            | 3. AssumeRoleWithWebIdentity (JWT)
            v
+--------------------------------------------------------------------+
|                         AWS STS (Security Token Service)           |
|  - Validate JWT signature with https://token.actions.githubusercontent.com
|  - Check Audience: sts.amazonaws.com                               |
|  - Check Subject Claim: repo:Kien-devops/app2:ref:refs/heads/main  |
+-----------------------------------+--------------------------------+
                                    |
                                    | 4. Issue temporary scoped credentials
                                    v
+--------------------------------------------------------------------+
|                 Assume IAM Role: GitHubActions-App2-ECRPush        |
|                 Permissions: ECR Push/Pull for app2-*              |
+--------------------------------------------------------------------+
```

### 2. Hướng dẫn chi tiết từng bước trên AWS Console

#### Bước 1: Khởi tạo Identity Provider trong AWS IAM
1. Đăng nhập vào [AWS Management Console](https://console.aws.amazon.com/).
2. Điều hướng tới dịch vụ **IAM** (Identity and Access Management).
3. Ở menu điều hướng bên trái, chọn **Identity providers** -> bấm **Add provider**.
4. Cấu hình các thông số:
   - **Provider type**: Chọn `OpenID Connect`.
   - **Provider URL**: Nhập chính xác:
     ```text
     https://token.actions.githubusercontent.com
     ```
   - **Audience**: Nhập chính xác:
     ```text
     sts.amazonaws.com
     ```
5. Bấm nút **Get thumbprint** để AWS tự động nạp chứng chỉ SSL của GitHub.
6. Bấm **Add provider**.

#### Bước 2: Tạo IAM Role với Trust Policy giới hạn chặt chẽ
1. Trong giao diện IAM, chọn menu **Roles** -> bấm **Create role**.
2. Tại mục **Trusted entity type**, chọn **Web identity**.
3. Cấu hình Identity provider:
   - **Identity provider**: Chọn `token.actions.githubusercontent.com`.
   - **Audience**: Chọn `sts.amazonaws.com`.
   - **GitHub organization**: Nhập `Kien-devops`.
   - **GitHub repository**: Nhập `app2`.
4. Bấm **Next**.
5. Đặt tên Role:
   ```text
   GitHubActions-App2-ECRPush
   ```
6. Bấm **Create role**.

#### Bước 3: Tinh chỉnh Trust Policy (Chỉ cho phép nhánh main push)
1. Bấm vào Role vừa tạo: `GitHubActions-App2-ECRPush`.
2. Chọn tab **Trust relationships** -> bấm **Edit trust policy**.
3. Dán nội dung chính sách sau (thay thế `<AWS_ACCOUNT_ID>` bằng Account ID thật của bạn):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Kien-devops/app2:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

> **Giải thích Trust Policy**:
> - Điều kiện `token.actions.githubusercontent.com:aud`: Đảm bảo request gửi tới STS.
> - Điều kiện `token.actions.githubusercontent.com:sub`: Bắt buộc request phải xuất phát từ repository `Kien-devops/app2` VÀ chỉ khi đang chạy trên nhánh `refs/heads/main`. Bất kỳ PR hay nhánh nhánh feature nào khác đều bị từ chối cấp quyền push.

#### Bước 4: Tạo IAM Policy cho quyền ECR giới hạn phạm vi `app2-*`
1. Trong tab **Permissions** của Role, bấm **Add permissions** -> **Create inline policy**.
2. Chọn trình soạn thảo **JSON** và dán chính sách phân quyền đặc quyền tối thiểu:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthTokenGlobal",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRPushPullApp2Only",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeRepositories",
        "ecr:ListImages",
        "ecr:DescribeImages",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": [
        "arn:aws:ecr:ap-southeast-1:<AWS_ACCOUNT_ID>:repository/app2-*"
      ]
    }
  ]
}
```

> **Giải thích IAM Policy**:
> - `ecr:GetAuthorizationToken` là API toàn cục dùng để lấy password đăng nhập docker, API này AWS yêu cầu `Resource: "*"`.
> - Tất cả các thao tác đẩy và tải image (`PutImage`, `UploadLayerPart`, v.v.) bị giới hạn tuyệt đối trong vùng Singapore (`ap-southeast-1`) và chỉ các repository có tiền tố `app2-*`.
> - Tuyệt đối không dùng `AdministratorAccess` hay `AmazonEC2ContainerRegistryFullAccess`.

### 3. Cấu hình biến môi trường trên GitHub Repository
1. Truy cập repository GitHub: `https://github.com/Kien-devops/app2`.
2. Vào **Settings** -> mục bên trái chọn **Secrets and variables** -> chọn **Actions**.
3. Chọn tab **Variables** (KHÔNG PHẢI Secrets, vì Role ARN không phải mật khẩu bí mật cần che giấu):
4. Bấm **New repository variable**:
   - **Name**: `AWS_GITHUB_ROLE_ARN`
   - **Value**: `arn:aws:iam::<AWS_ACCOUNT_ID>:role/GitHubActions-App2-ECRPush`
5. (Tùy chọn) Bấm **New repository variable**:
   - **Name**: `AWS_REGION`
   - **Value**: `ap-southeast-1`

## Commands
Cách kiểm tra và debug claim token bằng AWS CLI (nếu có tài khoản local):

```bash
# Xem thông tin cấu hình của Role
aws iam get-role --role-name GitHubActions-App2-ECRPush

# Xem Trust Relationship hiện tại
aws iam get-role --role-name GitHubActions-App2-ECRPush --query 'Role.AssumeRolePolicyDocument'
```

## Expected output
Trong GitHub Actions workflow step `Configure AWS credentials via OIDC`:
```text
Assuming role with OIDC...
Role assumed: arn:aws:iam::<AWS_ACCOUNT_ID>:role/GitHubActions-App2-ECRPush
Session expiration: ...
AWS credentials successfully configured.
```

## Verification
- Xác nhận job log không hiển thị bất kỳ dòng cảnh báo lỗi xác thực nào.
- Kiểm tra CloudTrail Event History trên AWS Console: Sự kiện `AssumeRoleWithWebIdentity` xuất hiện với trạng thái thành công, gắn nhãn `userName: GitHubActions-App2-ECRPush`.

## Troubleshooting
- **Lỗi `AssumeRoleWithWebIdentity: Not authorized to perform sts:AssumeRoleWithWebIdentity`**:
  - **Nguyên nhân**: Giá trị `sub` trong JWT của GitHub không khớp với Trust Policy. Thường gặp khi bạn chạy trên nhánh feature nhưng Trust Policy chỉ cho phép `ref:refs/heads/main`, hoặc tên repo bị sai hoa/thường.
  - **Khắc phục**: Kiểm tra lại claim `token.actions.githubusercontent.com:sub` trong Trust Policy. Đảm bảo đúng định dạng `repo:Kien-devops/app2:ref:refs/heads/main`.
- **Lỗi `Audience doesn't match`**:
  - **Khắc phục**: Đảm bảo Audience của Identity Provider là `sts.amazonaws.com`.
- **Lỗi `Missing or invalid id-token permission`**:
  - **Khắc phục**: File workflow `.github/workflows/ci.yml` bắt buộc phải có khai báo `permissions: id-token: write`.

## Security note
- Tuân thủ nguyên tắc Least Privilege: Giới hạn `StringLike: token.actions.githubusercontent.com:sub` vào đúng tổ chức và repo của bạn. Không bao giờ để `repo:*` vì bất kỳ ai trên GitHub cũng có thể mạo danh tài khoản AWS của bạn.
- Không chia sẻ Role ARN này với các repository công khai khác.

## Next step
Chuyển sang [LAB 07 - Đẩy Container Image Lên Amazon ECR](07-ecr-push.md) để tìm hiểu quy trình đăng nhập Docker và quản lý vòng đời Image.
