# Hệ thống chấm điểm phần trình bày

Ba trang:
- `/` : sinh viên quét QR, nhập họ tên + MSSV, chấm điểm trên điện thoại
- `/admin` : giảng viên điều khiển (cần mật khẩu)
- `/screen` : màn hình chiếu, hiện QR, số người vào phòng, điểm trực tiếp, kết quả

## Quy trình buổi chấm
1. Vào `/admin`, đăng nhập. Tải 2 file bảng điểm lớp (.xlsx). Chọn hình thức (Workshop / Video / Fanpage Facebook) cho từng nhóm. Bấm "Tạo mã QR và mở phòng chờ".
2. Mở `/screen` trên máy chiếu. Sinh viên quét QR, nhập họ tên và MSSV, vào màn hình chờ.
3. Khi đủ người, chọn phần trình bày đầu tiên và bấm "Kích hoạt hệ thống chấm".
4. Sinh viên (trừ nhóm đang trình bày) thấy bảng chấm đúng hình thức. Màn hình chiếu hiện điểm trực tiếp. Có nút đóng/mở chấm và chuyển nhóm.
5. Bấm "Kết thúc buổi chấm": từng nhóm thấy điểm tổng trên điện thoại, anh tải báo cáo Excel.

## Quy tắc
- MSSV phải có trong danh sách lớp và họ tên phải khớp (không phân biệt hoa thường, dấu).
- Sinh viên không chấm được nhóm của mình. Gửi rồi không sửa được.
- Điểm tổng mỗi lượt = trung bình có trọng số (thang 10). Điểm nhóm = trung bình các lượt chấm.
- Tên và MSSV người chấm chỉ có trong báo cáo Excel của giảng viên. Màn hình chiếu và các nhóm không thấy.
- Rubric nằm trong `rubrics.js`.

## Đưa lên mạng (ví dụ Render.com, gói miễn phí)
1. Tạo kho mã riêng tư (private) trên GitHub, tải toàn bộ thư mục này lên (không có dữ liệu sinh viên trong mã; danh sách lớp chỉ tải qua trang `/admin`).
2. Trên render.com chọn New > Web Service, nối kho mã.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: `ADMIN_PASSWORD` = mật khẩu giảng viên tự đặt
3. Mở đường link Render cấp (dạng `https://ten-ban-chon.onrender.com`). QR tự dùng đúng đường link này.

Lưu ý gói miễn phí: máy chủ ngủ sau ít phút không dùng, mở `/admin` trước giờ học 1 đến 2 phút cho nó thức. Dữ liệu nằm trong bộ nhớ và file tạm, nếu máy chủ khởi động lại thì có thể mất. Hãy tải báo cáo Excel ngay sau khi kết thúc buổi chấm.

## Chạy thử trên máy
`npm install` rồi `ADMIN_PASSWORD=matkhau npm start`, mở http://localhost:3000/admin
