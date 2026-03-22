import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const templates = [
  {
    slug: 'charging_complete',
    channel: 'BOTH' as const,
    priority: 'NORMAL' as const,
    titleEn: 'Charging Complete',
    titleLo: 'ສາກໄຟສໍາເລັດ',
    titleZh: '充电完成',
    bodyEn: 'Your vehicle has been fully charged. Please unplug to avoid parking fees.',
    bodyLo: 'ລົດຂອງທ່ານໄດ້ຊາກໄຟສໍາເລັດແລ້ວ. ກະລຸນາຖອດສາຍໄຟເພື່ອຫຼີກລ່ຽງຄ່າຈອດລົດ.',
    bodyZh: '您的车辆已充满电。请拔掉插头以避免停车费。',
  },
  {
    slug: 'soc_80',
    channel: 'FCM' as const,
    priority: 'NORMAL' as const,
    titleEn: 'Battery 80% Charged',
    titleLo: 'ແບດເຕີລີ່ 80% ສາກໄຟແລ້ວ',
    titleZh: '电量已充至80%',
    bodyEn: 'Your battery is at 80%. Charging will slow down soon.',
    bodyLo: 'ແບດເຕີລີ່ຂອງທ່ານ 80%. ການສາກໄຟຈະຊ້າລົງໃນໄວໆນີ້.',
    bodyZh: '您的电池已充至80%。充电速度即将降低。',
  },
  {
    slug: 'soc_100',
    channel: 'FCM' as const,
    priority: 'NORMAL' as const,
    titleEn: 'Battery Fully Charged',
    titleLo: 'ແບດເຕີລີ່ສາກໄຟເຕັມແລ້ວ',
    titleZh: '电池已充满',
    bodyEn: 'Your battery is at 100%. Please unplug to free up the charger.',
    bodyLo: 'ແບດເຕີລີ່ຂອງທ່ານ 100%. ກະລຸນາຖອດສາຍໄຟເພື່ອປ່ອຍຊ່ອງສາກ.',
    bodyZh: '您的电池已充满100%。请拔掉插头以释放充电桩。',
  },
  {
    slug: 'overstay_warning_1',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Parking Fee Warning',
    titleLo: 'ຄໍາເຕືອນຄ່າຈອດລົດ',
    titleZh: '停车费警告',
    bodyEn: 'Your vehicle is still connected after charging. Parking fees will begin in {freeMinutes} minutes.',
    bodyLo: 'ລົດຂອງທ່ານຍັງຕໍ່ຢູ່ຫຼັງຈາກສາກໄຟ. ຄ່າຈອດລົດຈະເລີ່ມໃນ {freeMinutes} ນາທີ.',
    bodyZh: '充电完成后您的车辆仍连接中。停车费将在{freeMinutes}分钟后开始计算。',
  },
  {
    slug: 'overstay_warning_2',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Parking Fee Starting Soon',
    titleLo: 'ຄ່າຈອດລົດກໍາລັງຈະເລີ່ມ',
    titleZh: '停车费即将开始',
    bodyEn: 'Parking fees of {rate} LAK/min will start in {minutes} minutes. Please move your vehicle.',
    bodyLo: 'ຄ່າຈອດລົດ {rate} ກີບ/ນາທີ ຈະເລີ່ມໃນ {minutes} ນາທີ. ກະລຸນາຍ້າຍລົດຂອງທ່ານ.',
    bodyZh: '{rate} 基普/分钟的停车费将在{minutes}分钟后开始。请移动您的车辆。',
  },
  {
    slug: 'overstay_warning_3',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Parking Fee Active Now',
    titleLo: 'ຄ່າຈອດລົດຄິດໄລ່ຢູ່ແລ້ວ',
    titleZh: '停车费正在计算',
    bodyEn: 'Parking fees are now being charged at {rate} LAK/min. Current fee: {totalFee} LAK.',
    bodyLo: 'ຄ່າຈອດລົດກໍາລັງຄິດໄລ່ທີ່ {rate} ກີບ/ນາທີ. ຄ່າໃຊ້ຈ່າຍປັດຈຸບັນ: {totalFee} ກີບ.',
    bodyZh: '停车费正以{rate}基普/分钟计算。当前费用：{totalFee}基普。',
  },
  {
    slug: 'overstay_charged',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Overstay Fee Charged',
    titleLo: 'ຄ່າຈອດລົດຄ້ານຖືກຫັກ',
    titleZh: '已扣除超时停车费',
    bodyEn: 'An overstay parking fee of {amount} LAK ({minutes} min) has been deducted from your wallet.',
    bodyLo: 'ຄ່າຈອດລົດຄ້ານ {amount} ກີບ ({minutes} ນາທີ) ຖືກຫັກຈາກກະເປົາເງິນຂອງທ່ານ.',
    bodyZh: '已从您的钱包中扣除{amount}基普（{minutes}分钟）的超时停车费。',
  },
  {
    slug: 'remote_start_failed',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Charging Start Failed',
    titleLo: 'ເລີ່ມສາກໄຟລົ້ມເຫລວ',
    titleZh: '启动充电失败',
    bodyEn: 'Unable to start charging at {chargerName}. Please try again or contact support.',
    bodyLo: 'ບໍ່ສາມາດເລີ່ມສາກໄຟທີ່ {chargerName}. ກະລຸນາລອງໃໝ່ຫຼືຕິດຕໍ່ຝ່າຍສຸພາບ.',
    bodyZh: '无法在{chargerName}启动充电。请重试或联系客服。',
  },
  {
    slug: 'charger_offline',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Charger Offline',
    titleLo: 'ເຄື່ອງສາກໄຟອອຟໄລ',
    titleZh: '充电桩离线',
    bodyEn: 'The charger {chargerName} is currently offline. Please try another charger.',
    bodyLo: 'ເຄື່ອງສາກໄຟ {chargerName} ກໍາລັງອອຟໄລ. ກະລຸນາລອງເຄື່ອງສາກໄຟອື່ນ.',
    bodyZh: '充电桩{chargerName}当前离线。请尝试其他充电桩。',
  },
  {
    slug: 'charger_rebooted',
    channel: 'FCM' as const,
    priority: 'HIGH' as const,
    titleEn: 'Charger Restarted',
    titleLo: 'ເຄື່ອງສາກໄຟໄດ້ຣີສຕາດ',
    titleZh: '充电桩已重启',
    bodyEn: 'The charger {chargerName} has restarted. Your session may have been interrupted.',
    bodyLo: 'ເຄື່ອງສາກໄຟ {chargerName} ໄດ້ຣີສຕາດ. ເຊດຊັ່ນຂອງທ່ານອາດຈະຖືກຂັດຂວາງ.',
    bodyZh: '充电桩{chargerName}已重启。您的充电会话可能已中断。',
  },
  {
    slug: 'system_maintenance',
    channel: 'BOTH' as const,
    priority: 'LOW' as const,
    titleEn: 'Scheduled Maintenance',
    titleLo: 'ການບໍາລຸງຮັກສາທີ່ກໍານົດໄວ້',
    titleZh: '计划维护',
    bodyEn: 'Panda EV will undergo scheduled maintenance on {date} from {startTime} to {endTime}.',
    bodyLo: 'Panda EV ຈະດໍາເນີນການບໍາລຸງຮັກສາທີ່ກໍານົດໄວ້ໃນວັນທີ {date} ຈາກ {startTime} ຫາ {endTime}.',
    bodyZh: 'Panda EV将于{date} {startTime}至{endTime}进行计划维护。',
  },
];

async function main() {
  console.log('Seeding notification templates...');

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { slug: template.slug },
      update: template,
      create: template,
    });
    console.log(`  ✓ ${template.slug}`);
  }

  console.log(`Seeded ${templates.length} notification templates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
