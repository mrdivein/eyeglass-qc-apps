# QC Scan

App Windows để QC hàng nhập bằng máy scan mã vạch: scan UPC, scan S/N, scan bảng mã lỗi theo vùng, scan vị trí, scan lệnh SAVE / BACK / REDO / UNDO.

## Cài đặt
Tải `QC Scan Setup x.y.z.exe` ở [Releases](https://github.com/mrdivein/eyeglass-qc-apps/releases/latest) và chạy. Lần đầu mở app, nhập Data URL, Data key và tên người QC ở Settings.

## Cập nhật bản mới (OTA)
App tự kiểm tra bản mới khi mở và mỗi 4 giờ, tải nền, hiện thanh "Restart now" khi sẵn sàng. Repo Private vẫn cập nhật được nếu nhập một fine-grained token chỉ có quyền đọc Contents của repo này vào ô Update token ở Settings (để trống khi repo Public). Dữ liệu QC nằm ở `%APPDATA%\QC Scan`, cập nhật hay gỡ cài đặt đều không xoá.

## Phát hành bản mới
1. Đổi `version` trong `package.json`.
2. Merge vào `main`. GitHub Actions chạy test, build bộ cài Windows và tạo release `vX.Y.Z`.

## Dữ liệu
- Danh sách lô, dòng hàng, sản phẩm, vị trí, bảng lỗi và cách xuất cột: lấy từ Data URL (endpoint chỉ đọc, có khoá). Không có cấu hình nào của hệ thống dữ liệu nằm trong repo này.
- Kết quả QC lưu local ở `%APPDATA%\QC Scan\records.jsonl`. Trang Saved có Copy rows (dán vào bảng tính) và Save CSV.

## Mã vạch
Code 128, chỉ gồm chữ hoa, số và dấu `-`: `QCS-D-<VÙNG>-<LỖI>`, `QCS-C-<LỆNH>`, `QCS-L-<VỊ TRÍ>`. In từ trang Code sheets.

## Phát triển
```
npm install
npm test
npm start
```
