<div align="center">

# goal-meter

**Goal meter สำหรับ Claude Code** แสดงเป้าหมายใหญ่ งานหลัก งานย่อย อะไรเสร็จแล้ว อะไรกำลังทำ ใช้เวลาไปเท่าไร และจะเสร็จเมื่อไร ใน pane ข้าง session

[![CI](https://github.com/TheerasakPing/goal-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/TheerasakPing/goal-meter/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/tag/TheerasakPing/goal-meter?label=version&color=6366f1)](https://github.com/TheerasakPing/goal-meter/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)

[English](README.md) · [ภาษาไทย](README.th.md)

<img src="docs/preview.svg" alt="หน้าตา goal-meter" width="820">

</div>

## ความสามารถ

- **เป้าหมาย งานหลัก งานย่อย** งานที่กำลังทำจะแตกงานย่อยเป็นต้นไม้
- **สีประจำงาน** งานหลักแต่ละงานมีสีของตัวเอง ใช้ทั้งในแถวงานและในช่วงของแถบความคืบหน้า
- **แถบความคืบหน้ารวม** งานที่เสร็จเติมแถบด้วยสีของงานนั้น งานที่กำลังทำกระพริบ งานที่ยังไม่เริ่มเป็นสีเทา แถบยาวเต็มความกว้าง pane
- **เวลาและ ETA** เวลาที่ใช้ทั้งเป้าหมายและรายงาน เวลาที่เหลือ และเวลาที่คาดว่าจะเสร็จ
- **ดูสถานะได้ทันที** `✔` เสร็จ (เขียว) · `◐` กำลังทำ (เหลือง หมุน) · `○` ยังไม่ทำ (เทา) งานย่อยที่เสร็จถูกขีดฆ่า
- **อัปเดตเอง** Claude เรียก tool `update` ให้เองตลอดการทำงาน
- **Status line** แสดง `Goal 52% (5/11) · ETA 14:52` แม้ปิด pane

## ติดตั้ง

พิมพ์ใน Claude Code แบบ terminal:

```
/plugin install goal-meter --marketplace TheerasakPing/goal-meter
```

ตอบ `y` เพื่อเพิ่ม marketplace แล้วเลือก scope (แนะนำ `user`) ใช้งานได้ทันที

**อัปเดต** เป็นเวอร์ชันล่าสุด:

```
claude plugin marketplace update goal-meter
```

## ใช้งาน

สั่งงานหลายขั้นตอนให้ Claude ได้เลย meter จะเปิดและอัปเดตเองระหว่างทำงาน

| คำสั่ง | ทำอะไร |
| --- | --- |
| `/goal-meter` | เปิด pane |
| `/goal-meter <เป้าหมาย>` | ตั้งเป้าหมายเองแล้วเปิด pane |
| `/goal-meter clear` | ล้างเป้าหมาย |

ถ้าจอแคบ pane จะยังไม่เปิดเอง ให้พิมพ์ `/goal-meter`

## ทำงานอย่างไร

- **เวลา** mod เป็นคนจับเวลาเอง เริ่มนับเมื่อเห็นงานเป็น "กำลังทำ" ครั้งแรก หยุดเมื่อเห็นเป็น "เสร็จ" ครั้งแรก
- **งานที่มีงานย่อย** สถานะตามงานย่อย: เสร็จเมื่อครบทุกตัว กำลังทำเมื่อเริ่มสักตัว
- **ความคืบหน้า** นับงานย่อยเป็นหน่วย (งานที่ไม่มีงานย่อยนับเป็น 1) เสร็จ = 1, กำลังทำ = ½
- **ETA** = เวลาที่ใช้ไป × (1 − ความคืบหน้า) ÷ ความคืบหน้า

รายละเอียด schema ของ tool และการพัฒนาดูที่ [README.md](README.md)

## License

[MIT](LICENSE) © TheerasakPing
