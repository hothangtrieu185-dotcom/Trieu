# Hệ thống chấm điểm phần trình bày

Ba trang:
- `/` : sinh viên quét QR, nhập họ tên + MSSV, chấm điểm trên điện thoại
- `/admin` : giảng viên điều khiển (cần mật khẩu)
- `/screen` : màn hình chiếu, hiện QR, số người vào phòng, điểm trực tiếp, kết quả

## Quy trình buổi chấm (một phòng chấm chung)
1. Vào `/admin`, đăng nhập. Tải file bảng điểm lớp (.xlsx). Bấm "Tạo mã QR và mở phòng chờ".
2. Mở `/screen` trên máy chiếu. Sinh viên quét QR, nhập họ tên và MSSV, vào màn hình chờ.
3. Ở phòng chờ, chọn hình thức (Workshop / Video / Fanpage Facebook) cho TẤT CẢ các nhóm, rồi bấm "Mở phòng chấm".
4. Cả lớp cùng ở trong một phòng chấm: mỗi sinh viên thấy danh sách các nhóm khác (không có nhóm của mình), chấm nhóm nào trước cũng được, sửa điểm được đến khi giảng viên đóng phòng. Màn hình chiếu hiện điểm trực tiếp của từng nhóm.
5. Bấm "Đóng phòng chấm" khi xong, rồi "Kết thúc buổi chấm": từng nhóm thấy điểm tổng trên điện thoại, anh tải báo cáo Excel.

## Quy tắc
- MSSV phải có trong danh sách lớp và họ tên phải khớp (không phân biệt hoa thường, dấu).
- Sinh viên không chấm được nhóm của mình. Sửa điểm được đến khi giảng viên đóng phòng chấm.
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

## Chấm chéo trong nhóm HMO102 (phòng chờ)
Chạy chung máy chủ này, đường dẫn riêng:
- `/hmo102` : sinh viên quét QR, nhập MSSV và họ tên, hệ thống tự nhận nhóm, vào phòng chờ
- `/hmo102/admin` : giảng viên (mật khẩu trong biến môi trường `HMO102_PASSWORD`), nạp danh sách lớp, chọn nhóm, bắt đầu 5/10/15/20 phút, xem kết quả, tải Excel
- `/hmo102/screen` : màn hình chiếu, QR và số người đã vào

Quy trình: nạp file bảng điểm .xlsx của lớp ở trang admin (bạn không có nhóm tự bị loại), chiếu `/hmo102/screen`, các bạn quét QR vào phòng chờ, chọn nhóm rồi bấm Bắt đầu. Phiếu chấm tự mở trên máy các bạn của nhóm đó, hết giờ tự khóa. Hệ số điều chỉnh = TB nhận được chia TB cả nhóm, giới hạn 0,80 đến 1,10.
Mã nguồn: `hmo102.js`, các trang trong `public/h/`.
