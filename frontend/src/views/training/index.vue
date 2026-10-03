<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>人员培训管理</h2>
        <p class="page-desc">维护培训记录，围绕培训编号、培训主题、受训岗位、培训方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
        <button class="btn" type="button" @click="exportRows">导出人员培训清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showCreate" class="filter-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="draft[field]" :placeholder="`填写${field}`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="cancelCreate">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('training')
const columns = ["培训编号", "培训主题", "受训岗位", "培训方式", "考核成绩", "培训日期", "有效期至", "培训状态"]
const actions = ["提交培训", "判定合格", "判定未通过"]
const statuses = ["待培训", "培训中", "已合格", "未通过"]
const statCards = [{"label": "待培训人员", "status": "待培训"}, {"label": "培训中人员", "status": "培训中"}, {"label": "已合格人员", "status": "已合格"}, {"label": "未通过人员数", "status": "未通过"}]
const createFields = ["培训主题", "受训岗位", "培训方式"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const draft = ref<Record<string, string>>({})

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 概览卡片与下方列表、状态图例读的是同一份行数据，合格人数两边必然对得上。
const stats = computed(() =>
  statCards.map((item: { label: string; status: string }) => ({
    label: item.label,
    value: countByStatus(item.status),
  })),
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countByStatus(status),
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  draft.value = {}
  showCreate.value = true
}

function cancelCreate() {
  showCreate.value = false
  draft.value = {}
}

function submitCreate() {
  errorMessage.value = ''
  const result = createEntry(meta.key, draft.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  cancelCreate()
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人员培训列表读取失败'
  }
}

onMounted(reload)
</script>
