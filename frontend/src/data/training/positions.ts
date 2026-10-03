// 受训岗位共享目录：培训登记、判定弹窗、条件筛选等所有入口都取这一份，
// 页面不再各自硬编码，避免同一个岗位在不同入口拿到不同口径。
export const TRAINING_POSITIONS: string[] = [
  '无菌灌装岗',
  '配液岗',
  '轧盖岗',
  '灯检岗',
  '包装岗',
  '洁净区清洁岗',
  'QC 检验岗',
  '仓储收发岗',
]

// 培训方式也统一收口，登记与判定时拿到的选项一致。
export const TRAINING_METHODS: string[] = ['在岗带教', '集中授课', '线上学习', '实操演练']

export function isValidTrainingPosition(position: string): boolean {
  return TRAINING_POSITIONS.includes(position)
}
