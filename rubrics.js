// Rubric chấm điểm theo hình thức dự án. Mỗi hình thức có 5 tiêu chí, tổng trọng số = 100.
// Điểm mỗi tiêu chí: thang 10, bước 0.5. Điểm tổng = trung bình có trọng số (thang 10).
module.exports = {
  workshop: {
    label: 'Workshop',
    criteria: [
      { id: 'c1', name: 'Ý tưởng và mục tiêu', weight: 20, desc: 'Mục tiêu rõ ràng, chủ đề sáng tạo, phù hợp doanh nghiệp và người tham dự' },
      { id: 'c2', name: 'Nội dung và kịch bản chương trình', weight: 25, desc: 'Nội dung có giá trị, kịch bản mạch lạc, phân bổ thời gian hợp lý' },
      { id: 'c3', name: 'Tổ chức và điều phối hoạt động', weight: 25, desc: 'Hoạt động hấp dẫn, điều phối trơn tru, chuẩn bị đạo cụ và không gian tốt' },
      { id: 'c4', name: 'Tương tác và hiệu quả', weight: 20, desc: 'Người tham dự hứng thú, tham gia tích cực, mang lại giá trị thực tế cho doanh nghiệp' },
      { id: 'c5', name: 'Thuyết trình, trả lời và phối hợp nhóm', weight: 10, desc: 'Trình bày tự tin, trả lời chắc chắn, các thành viên cùng tham gia' },
    ],
  },
  video: {
    label: 'Video',
    criteria: [
      { id: 'c1', name: 'Ý tưởng và thông điệp', weight: 25, desc: 'Ý tưởng sáng tạo, thông điệp rõ ràng, phù hợp doanh nghiệp và đối tượng mục tiêu' },
      { id: 'c2', name: 'Kịch bản và cách kể chuyện', weight: 20, desc: 'Cấu trúc chặt chẽ, dẫn dắt cuốn hút, độ dài hợp lý' },
      { id: 'c3', name: 'Chất lượng hình ảnh, âm thanh, dựng', weight: 25, desc: 'Hình ảnh rõ nét, âm thanh sạch, dựng mượt, có tính thẩm mỹ' },
      { id: 'c4', name: 'Hiệu quả truyền thông và tính ứng dụng', weight: 20, desc: 'Thu hút người xem, doanh nghiệp có thể sử dụng thực tế' },
      { id: 'c5', name: 'Thuyết trình, trả lời và phối hợp nhóm', weight: 10, desc: 'Giới thiệu sản phẩm tự tin, trả lời chắc chắn, các thành viên cùng tham gia' },
    ],
  },
  fanpage: {
    label: 'Fanpage Facebook',
    criteria: [
      { id: 'c1', name: 'Ý tưởng và định vị', weight: 20, desc: 'Định vị rõ ràng, phù hợp doanh nghiệp và đối tượng mục tiêu, có kế hoạch nội dung' },
      { id: 'c2', name: 'Chất lượng nội dung bài đăng', weight: 25, desc: 'Nội dung hấp dẫn, đa dạng định dạng, lời văn phù hợp, có lời kêu gọi hành động' },
      { id: 'c3', name: 'Thiết kế và nhận diện thương hiệu', weight: 20, desc: 'Hình ảnh đẹp, màu sắc và phong cách nhất quán, nhận diện thương hiệu rõ' },
      { id: 'c4', name: 'Kết quả tương tác và hiệu quả', weight: 25, desc: 'Số liệu tiếp cận, tương tác, tăng trưởng và khả năng mang lại giá trị cho doanh nghiệp' },
      { id: 'c5', name: 'Thuyết trình, trả lời và phối hợp nhóm', weight: 10, desc: 'Trình bày kết quả tự tin, trả lời chắc chắn, các thành viên cùng tham gia' },
    ],
  },
};
