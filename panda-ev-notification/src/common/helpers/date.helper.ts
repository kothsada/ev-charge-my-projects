import moment from 'moment-timezone';

const TZ = 'Asia/Vientiane';

export const nowBangkokIso = () => moment().tz(TZ).format();
export const toBangkokIso = (d: Date) => moment(d).tz(TZ).format();
export const startOfDay = (d: Date) => moment(d).tz(TZ).startOf('day').toDate();
export const startOfHour = (d: Date) => moment(d).tz(TZ).startOf('hour').toDate();
