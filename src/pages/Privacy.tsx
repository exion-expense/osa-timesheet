import { Logo } from '../components/Layout'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-2xl rounded-2xl bg-white p-6 text-slate-700 shadow-sm sm:p-10">
        <Logo className="h-10" />
        <h1 className="mt-6 text-2xl font-semibold text-slate-900">ประกาศความเป็นส่วนตัว (PDPA)</h1>
        <p className="mt-1 text-sm text-slate-500">ระบบลงเวลาผู้รับเหมา — OSA Valve Services (Thailand) Co., Ltd.</p>

        <h2 className="mt-6 font-semibold text-slate-900">ข้อมูลที่เก็บ</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>ผู้รับเหมา: ชื่อ-นามสกุล ตำแหน่ง ทีม/จ็อบที่ทำงาน เวลาเข้า-ออกงาน ค่าแรงและเบี้ยเลี้ยง</li>
          <li>พนักงาน: อีเมล ชื่อ ตำแหน่ง และประวัติการอนุมัติ/แก้ไขข้อมูล</li>
          <li>ระบบ <b>ไม่เก็บ</b> เลขบัตรประชาชน ข้อมูลบัญชีธนาคาร รูปถ่าย หรือพิกัดตำแหน่ง</li>
        </ul>

        <h2 className="mt-6 font-semibold text-slate-900">วัตถุประสงค์และฐานทางกฎหมาย</h2>
        <p className="mt-2">
          เพื่อบันทึกเวลาทำงาน คำนวณและจ่ายค่าจ้างตามสัญญาจ้างเหมา (ฐานสัญญา) และเพื่อจัดทำเอกสารทางบัญชีและภาษีตามกฎหมาย (ฐานหน้าที่ตามกฎหมาย)
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">การเปิดเผยและการเข้าถึง</h2>
        <p className="mt-2">
          เข้าถึงได้เฉพาะพนักงานที่เกี่ยวข้องตามหน้าที่ (หัวหน้างานเห็นเฉพาะจ็อบที่ตนดูแล ข้อมูลค่าแรงเห็นเฉพาะฝ่ายที่เกี่ยวข้อง) ข้อมูลจัดเก็บบนผู้ให้บริการคลาวด์ที่มีการเข้ารหัส และไม่ขายหรือส่งต่อให้บุคคลภายนอก
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">ระยะเวลาเก็บรักษา</h2>
        <p className="mt-2">เก็บไว้ไม่เกิน 5 ปีนับจากวันที่จ่ายเงิน ตามระยะเวลาเก็บเอกสารทางบัญชี จากนั้นจะลบหรือทำให้ไม่สามารถระบุตัวตนได้</p>

        <h2 className="mt-6 font-semibold text-slate-900">สิทธิของเจ้าของข้อมูล</h2>
        <p className="mt-2">
          ท่านมีสิทธิขอเข้าถึง แก้ไข ลบ หรือคัดค้านการประมวลผลข้อมูลของท่านตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 โดยติดต่อหัวหน้างานหรือฝ่ายบุคคลของบริษัท
        </p>
      </article>
    </div>
  )
}
