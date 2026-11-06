# HMO102 chấm chéo trong nhóm

- `index.html`: trang cho sinh viên (quét QR). Chọn nhóm, chọn tên, nhập mã nhóm, chấm 1 đến 5 cho 4 tiêu chí.
- `admin.html`: trang tổng hợp cho giảng viên. Dán cột "Mã kết quả" từ Google Sheet của Google Form, xem hệ số điều chỉnh, tải Excel.
- `config.js`: danh sách nhóm, thành viên, hạn nộp, địa chỉ Google Form. Mã nhóm không nằm trong mã nguồn, chỉ có bản băm SHA-256 của `idNhóm:MÃ`.

Sinh viên nộp bài bằng cách trang tự gửi một mã kết quả (chuỗi HMO1...) vào Google Form. Nếu gửi lỗi, sinh viên sao chép mã dự phòng gửi tay.
