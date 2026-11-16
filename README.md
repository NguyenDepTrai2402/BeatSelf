# BeatSelf — bản thử nghiệm cửa hàng nhạc số

BeatSelf là mã nguồn thử nghiệm cho một cửa hàng beat cá nhân, lấy cảm hứng từ luồng tìm beat, nghe thử và lựa chọn giấy phép của BeatStars. Thiết kế, tên, beat mẫu và mã nguồn của BeatSelf là riêng; không sử dụng tài nguyên, dữ liệu hoặc thương hiệu BeatStars.

## Tình trạng

- **Bản local có backend thử nghiệm:** tài khoản, session, đăng và sửa beat/ảnh/file, phân quyền admin/mod/customer, nhật ký quản trị, chat, đơn hàng, QR chuyển khoản và xác nhận thủ công, tải file sau khi xác nhận.
- Vercel chạy storefront và dashboard tại `/admin`. Vercel Functions dùng cùng logic phân quyền với server local. Mỗi request đọc snapshot SQLite mới nhất từ private Blob. Trước khi trả thành công cho thao tác ghi, server lưu snapshot với điều kiện ETag. Nếu có xung đột, client nhận HTTP 409 để thử lại. Kiến trúc này dành cho cửa hàng thử nghiệm ít người dùng.
- Trên Vercel, đặt `BLOB_READ_WRITE_TOKEN`, `ADMIN_EMAIL` và `ADMIN_PASSWORD_HASH` (salt hex + dấu hai chấm + scrypt 64 byte ở dạng hex). File tải thẳng vào private Blob qua URL có giới hạn dung lượng và thời hạn. Server kiểm tra loại file trước khi cho gắn vào beat.
- Trước khi thu tiền thật cần bổ sung khôi phục mật khẩu, bảo vệ đăng nhập, sao lưu và kiểm tra quy trình đối soát. VietQR tạo mã chuyển khoản theo đơn, admin xác nhận tiền thủ công.
- Các điều khoản giấy phép, giá mẫu và lựa chọn Basic/Premium chỉ để minh họa. Hiện cả hai loại đều giao cùng một file gốc; chưa có hợp đồng, kiểm soát phạm vi sử dụng hay xử lý bản quyền. Exclusive đã tắt. Cần thiết kế lại file và hợp đồng theo từng giấy phép trước khi bán.
- Sáu beat demo là âm thanh do chương trình tổng hợp, không phải sản phẩm để mua. Không dùng cho mục đích thương mại thay beat thật.

## Chạy trên Windows

Cài Node.js phiên bản **24 trở lên**. Giải nén mã nguồn, mở PowerShell tại thư mục có `package.json` và chạy:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "DatMatKhauRiengItNhat12KyTu!"
npm start
```

Mở `http://localhost:3000`. Tài khoản admin được tạo khi khởi động lần đầu, nếu email chưa có trong cơ sở dữ liệu. Hãy thay email và mật khẩu ví dụ bằng giá trị của riêng mày. Thay biến môi trường sau đó không đổi mật khẩu của tài khoản đã tạo. Không chia sẻ dữ liệu thật hoặc mở server ra Internet.

Đăng nhập admin → Quản trị (hoặc mở `/admin`) → Ngân hàng để nhập mã ngân hàng/BIN, số tài khoản và chủ tài khoản; Quản trị → Tải beat để đăng một beat thật gồm ảnh, audio preview và file gốc. Người mua đăng ký tài khoản, tạo đơn, quét mã. Admin kiểm tra giao dịch thực nhận trước khi xác nhận; người mua có thể tải file sau đó.

Muốn cấp quyền mod: người đó tự đăng ký tài khoản → admin vào Quản trị → Phân quyền → chọn vai trò mod và bật các quyền cần thiết. Quyền xem đơn và quyền xác nhận tiền là hai quyền riêng. Admin tự quản lý tài khoản ngân hàng và quyền; mod không có các quyền này. Hoạt động sửa quyền, đăng/sửa beat, trả lời chat và xác nhận đơn được lưu vào nhật ký.

Dữ liệu local được lưu trong thư mục `data/`, không đưa lên Git. Dashboard quản trị tách riêng tại `/admin`. Ảnh JPG/PNG/WebP tối đa 10 MB, audio MP3/WAV/M4A/FLAC/OGG tối đa 100 MB mỗi file. Các file được tải độc lập và có tiến trình; dữ liệu vẫn lưu trên máy chạy server và cần chuyển sang object storage bền vững trước khi kinh doanh.

## Kiểm thử

```powershell
npm test
```

Kiểm thử tích hợp tạo dữ liệu tạm, kiểm tra quyền, tạo đơn, kiểm tra giá tại server, chặn tải trước thanh toán, xác nhận và tải sau thanh toán, quyền mod, cách ly tin nhắn và nhật ký.

## Thiết kế backend thử nghiệm

- Node.js HTTP + SQLite tích hợp; dữ liệu nằm trong `data/beatself.sqlite`, file trong `data/media/`.
- Mật khẩu băm bằng scrypt, session trong cookie HttpOnly/SameSite, kiểm tra quyền ở server; tài khoản mới chỉ có quyền customer.
- File gốc không được phục vụ công khai theo đường dẫn media; chỉ chủ đơn đã thanh toán mới tải qua endpoint đơn hàng. Audio nghe thử và artwork được công khai.
- Ngân hàng được cấu hình ở máy chủ; ảnh QR được tạo bằng VietQR Quick Link với số tiền và mã đơn. Việc hiển thị QR **không** chứng minh có giao dịch. Không có webhook ngân hàng hay tự đối soát; chỉ người được cấp quyền mới có thể xác nhận thủ công.
- Các đơn có mã tham chiếu ngẫu nhiên, giá được tính lại ở server. Chỉ xác nhận khi đã kiểm tra đúng số tiền và nội dung chuyển khoản.

## Việc còn lại trước sản xuất

1. Chọn và kết nối PostgreSQL bền vững và storage riêng tư; di chuyển cả database lẫn file, dùng URL tải ngắn hạn theo quyền. Vercel Functions không phải nơi lưu SQLite/file bền vững.
2. Dùng nhà cung cấp xác thực chính thức hoặc hoàn thiện email verification, password reset, rate limiting, quản lý phiên, MFA cho admin, kiểm thử bảo mật và backup.
3. Xây dựng điều khoản giấy phép và file riêng theo từng loại; giải quyết tính độc quyền và lịch sử bán, invoice và quyền sở hữu trí tuệ.
4. Kết nối một nhà cung cấp chuyển khoản/webhook đã chọn: xác thực webhook theo tài liệu nhà cung cấp, kiểm tra số tiền, tài khoản, mã đơn, chống xử lý trùng, ghi nhận giao dịch và xử lý hoàn tiền. Đừng tin thông báo từ trình duyệt hay việc hiển thị QR.
5. Bổ sung bảo vệ upload (size, MIME, quét nội dung, giới hạn tốc độ, các trường hợp file hỏng), chức năng kiểm duyệt, chính sách lưu dữ liệu và bảo vệ thông tin khách hàng.
6. Thực hiện kiểm thử đầu cuối trong môi trường staging với giao dịch thử, backup/khôi phục và giám sát, sau đó mới bật kinh doanh.

## Tài liệu tham khảo

- BeatStars: https://www.beatstars.com/studio/sell-beats
- BeatStars giấy phép: https://help.beatstars.com/hc/en-us/articles/54320717002395-Content-Licenses-Contracts-FAQs
- VietQR Quick Link: https://www.vietqr.io/qr-dong
