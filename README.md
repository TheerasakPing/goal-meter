# goal-meter

Claude Code mod ที่แสดง **Goal Meter** เป็น pane: เป้าหมายใหญ่ งานหลัก งานย่อย สีตามสถานะ เวลาที่ใช้ และเวลาที่คาดว่าจะเสร็จ

```
 GOAL  Ship login
████████░░░░░░░░ 45% 2/4 ใช้ 3m10s · เหลือ ~4m · เสร็จ 14:52
✔ 1. Design                  ●●● 2m
◓ 2. Build                        3m
  ├ ✔ API
  └ ○ UI
○ 3. Test                      ··
```

## ติดตั้ง

พิมพ์ใน Claude Code (terminal):

```
/plugin install goal-meter --marketplace TheerasakPing/goal-meter
```

ตอบ `y` เพื่อเพิ่ม marketplace แล้วเลือก scope (แนะนำ user)

## ใช้งาน

- Claude อัปเดต meter เองผ่าน tool `mcp__goal-meter__update` เมื่อทำงานหลายขั้นตอน
- `/goal-meter <ข้อความ>` ตั้งเป้าหมายเองและเปิด pane
- `/goal-meter` เปิด pane
- `/goal-meter clear` ล้างเป้าหมาย

สถานะ: `✔` เสร็จ (เขียว) · `◐` กำลังทำ (เหลือง หมุน) · `○` ยังไม่ทำ (เทา)

ETA = เวลาที่ใช้ไป × ส่วนที่เหลือ / ส่วนที่เสร็จ (นับงานย่อยเป็นหน่วย, งานที่กำลังทำนับครึ่ง)

## พัฒนา

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

## License

MIT
