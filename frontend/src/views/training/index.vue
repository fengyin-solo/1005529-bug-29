<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>人员培训管理</h2>
        <p class="page-desc">维护培训记录，围绕培训编号、培训主题、受训岗位、培训方式做登记、筛选与状态流转。考核成绩判定时按实际口径重算，概览、抽屉与台账同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
        <button class="btn" type="button" @click="exportRows">导出人员培训清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article
        v-for="item in stats"
        :key="item.label"
        class="stat-card stat-clickable"
        :class="{ 'stat-card-on': item.status === drawerFilter }"
        @click="openDrawer(item.status)"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>培训编号</span>
        <input v-model="filters['培训编号']" placeholder="按培训编号检索" />
      </label>
      <label class="filter-item">
        <span>培训主题</span>
        <input v-model="filters['培训主题']" placeholder="按培训主题检索" />
      </label>
      <label class="filter-item">
        <span>受训岗位</span>
        <select v-model="filters['受训岗位']">
          <option value="">全部岗位</option>
          <option v-for="position in positions" :key="position" :value="position">{{ position }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-if="actionForRow(String(row.status)) === ACTION_SUBMIT"
              class="link"
              type="button"
              @click="submitRow(row)"
            >
              {{ ACTION_SUBMIT }}
            </button>
            <template v-else>
              <button
                v-for="action in judgeActionsFor(String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="openJudge(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-if="allowedActionsFor(String(row.status)).length === 0" class="muted-text">已闭环</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无人员培训数据，可先登记培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条人员培训记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 概览抽屉：卡片数字和抽屉列表是同一份 rows 现算，点开即可逐人核对 -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>{{ drawerTitle }}（{{ drawerRows.length }} 人）</h3>
          <button class="btn ghost" type="button" @click="closeDrawer">关闭</button>
        </header>
        <ul class="drawer-list">
          <li v-for="row in drawerRows" :key="String(row.id)">
            <span class="drawer-main">{{ row['培训编号'] }} · {{ row['培训主题'] }}</span>
            <span class="drawer-sub">{{ displayValue(row, '受训岗位') }} ｜ 成绩 {{ displayValue(row, '考核成绩') }} ｜ 有效期 {{ displayValue(row, '有效期至') }}</span>
          </li>
          <li v-if="!drawerRows.length" class="empty-state">当前没有「{{ drawerTitle }}」的记录</li>
        </ul>
      </aside>
    </div>

    <!-- 明细抽屉：单条记录的判定后口径，与表格、概览同源 -->
    <div v-if="detailRow" class="drawer-mask" @click.self="detailRow = null">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>培训记录明细</h3>
          <button class="btn ghost" type="button" @click="detailRow = null">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ displayValue(detailRow, column) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
      </aside>
    </div>

    <!-- 判定弹窗：成绩 0-100 极值挡回，合格线 60，合格后按培训日期重算一年有效期 -->
    <div v-if="judgeRow" class="modal-mask" @click.self="closeJudge">
      <form class="modal" @submit.prevent="confirmJudge">
        <h3>{{ judgeAction }} · {{ judgeRow['培训编号'] }}</h3>
        <p class="modal-desc">{{ judgeRow['培训主题'] }} ｜ {{ judgeRow['受训岗位'] }}</p>
        <label class="form-item">
          <span>考核成绩（{{ SCORE_MIN }}-{{ SCORE_MAX }}，合格线 {{ PASS_SCORE }}）</span>
          <input v-model="judgeScore" type="number" :min="SCORE_MIN" :max="SCORE_MAX" placeholder="请输入考核成绩" />
        </label>
        <label class="form-item">
          <span>判定日期</span>
          <input v-model="judgeDate" type="date" />
        </label>
        <p v-if="judgeError" class="error-text">{{ judgeError }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeJudge">取消</button>
          <button class="btn primary" type="submit">确认{{ judgeAction }}</button>
        </footer>
      </form>
    </div>

    <!-- 登记弹窗：受训岗位/培训方式只能选共享目录里的项 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <form class="modal" @submit.prevent="confirmCreate">
        <h3>登记培训记录</h3>
        <label class="form-item">
          <span>培训主题</span>
          <input v-model="createForm.topic" placeholder="请输入培训主题" />
        </label>
        <label class="form-item">
          <span>受训岗位</span>
          <select v-model="createForm.position">
            <option value="" disabled>请选择受训岗位</option>
            <option v-for="position in positions" :key="position" :value="position">{{ position }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>培训方式</span>
          <select v-model="createForm.method">
            <option value="" disabled>请选择培训方式</option>
            <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>培训日期</span>
          <input v-model="createForm.trainingDate" type="date" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">保存登记</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  registerTraining,
  runAction as applyAction,
} from '@/api/local-service'
import {
  ACTION_SUBMIT,
  PASS_SCORE,
  SCORE_MAX,
  SCORE_MIN,
  STATUS_FAILED,
  STATUS_PASSED,
  STATUS_PENDING,
  STATUS_TRAINING,
  allowedActionsFor,
} from '@/data/training/service'
import { TRAINING_METHODS, TRAINING_POSITIONS } from '@/data/training/positions'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('training')
const columns = ['培训编号', '培训主题', '受训岗位', '培训方式', '考核成绩', '培训日期', '有效期至', '培训状态']
const positions = TRAINING_POSITIONS
const methods = TRAINING_METHODS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({ 培训编号: '', 培训主题: '', 受训岗位: '' })

const statusOrder = [STATUS_PENDING, STATUS_TRAINING, STATUS_PASSED, STATUS_FAILED]
const countByStatus = (status: string) => rows.value.filter((row) => String(row.status) === status).length

// 卡片全部由同一份 rows 现算，不再有写死的初值，刷新/重进不会先跳旧值再回退。
const stats = computed(() => [
  { label: '待培训人员', value: countByStatus(STATUS_PENDING), status: STATUS_PENDING },
  { label: '培训中人员', value: countByStatus(STATUS_TRAINING), status: STATUS_TRAINING },
  { label: '合格人数', value: countByStatus(STATUS_PASSED), status: STATUS_PASSED },
  { label: '未通过人员数', value: countByStatus(STATUS_FAILED), status: STATUS_FAILED },
])

const statusSummary = computed(() =>
  statusOrder.map((status) => ({ status, count: countByStatus(status) })),
)

// 历史记录里的考核成绩/有效期按原样保留，空值统一展示为「—」。
function displayValue(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === null || String(value) === '' ? '—' : String(value)
}

function resetFilters() {
  filters['培训编号'] = ''
  filters['培训主题'] = ''
  filters['受训岗位'] = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const activeFilters: Record<string, string> = {}
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim() !== '') {
        activeFilters[key] = value
      }
    }
    const payload = listEntries(meta.key, activeFilters)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人员培训列表读取失败'
  }
}

// ---- 概览抽屉：与卡片同一个 countByStatus，数字和列表必然对得上 ----
const drawerOpen = ref(false)
const drawerFilter = ref('')
const drawerRows = computed(() => rows.value.filter((row) => String(row.status) === drawerFilter.value))
const drawerTitle = computed(() => drawerFilter.value)

function openDrawer(status: string) {
  drawerFilter.value = status
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

// ---- 明细抽屉 ----
const detailRow = ref<EntryRow | null>(null)
function openDetail(row: EntryRow) {
  detailRow.value = row
}

// 待培训只有「提交培训」一个动作，直接推进不弹判定框；培训中才弹判定框填成绩。
function actionForRow(status: string): string {
  const actions = allowedActionsFor(status)
  return actions.length === 1 && actions[0] === ACTION_SUBMIT ? ACTION_SUBMIT : ''
}

function judgeActionsFor(status: string): string[] {
  return allowedActionsFor(status).filter((action) => action !== ACTION_SUBMIT)
}

function submitRow(row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), ACTION_SUBMIT)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// ---- 判定弹窗 ----
const judgeRow = ref<EntryRow | null>(null)
const judgeAction = ref('')
const judgeScore = ref('')
const judgeDate = ref('')
const judgeError = ref('')

function today() {
  return new Date().toISOString().slice(0, 10)
}

function openJudge(action: string, row: EntryRow) {
  judgeRow.value = row
  judgeAction.value = action
  judgeScore.value = ''
  judgeDate.value = today()
  judgeError.value = ''
}

function closeJudge() {
  judgeRow.value = null
}

function confirmJudge() {
  if (!judgeRow.value) {
    return
  }
  const result = applyAction(meta.key, Number(judgeRow.value.id), judgeAction.value, {
    score: judgeScore.value,
    judgedAt: judgeDate.value,
  })
  if (!result.ok) {
    judgeError.value = result.message
    return
  }
  closeJudge(); reload()
}

// ---- 登记弹窗 ----
const createOpen = ref(false)
const createError = ref('')
const createForm = reactive({ topic: '', position: '', method: '', trainingDate: '' })

function openCreate() {
  createForm.topic = ''
  createForm.position = ''
  createForm.method = ''
  createForm.trainingDate = today()
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function confirmCreate() {
  const result = registerTraining({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  closeCreate(); reload()
}

// 模板动作按钮与 service 共用同一份状态机。

onMounted(reload)
</script>
