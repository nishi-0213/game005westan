export const SCHEDULE_MODES=['free','work','sleep'] as const;
export type ScheduleMode=typeof SCHEDULE_MODES[number];
export const SCHEDULE_LABELS:Record<ScheduleMode,string>={free:'自由',work:'仕事',sleep:'睡眠'};
export function initialSchedule():ScheduleMode[]{return Array<ScheduleMode>(24).fill('free');}
export function scheduleAt(schedule:readonly ScheduleMode[]|undefined,hour:number):ScheduleMode{return schedule?.[((Math.floor(hour)%24)+24)%24]??'free';}
export function nextSchedule(mode:ScheduleMode):ScheduleMode{return SCHEDULE_MODES[(SCHEDULE_MODES.indexOf(mode)+1)%3];}
