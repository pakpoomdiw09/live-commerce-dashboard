'use client'

import type {
  ActivityPoint,
  HourActivityPoint,
} from '@/lib/features/overview/overview-activity-core'

const number = (value: number) => value.toLocaleString('th-TH')
const chartWidth = 720
const chartHeight = 230
const padding = { top: 18, right: 16, bottom: 34, left: 38 }

function linePath(values: number[], max: number) {
  const width = chartWidth - padding.left - padding.right
  const height = chartHeight - padding.top - padding.bottom
  const x = (index: number) =>
    padding.left + (values.length < 2 ? width / 2 : (index / (values.length - 1)) * width)
  const y = (value: number) => padding.top + height - (value / max) * height
  return values.map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`).join(' ')
}

export function MessageActivityChart({ data }: { data: ActivityPoint[] | null }) {
  if (data === null) {
    return (
      <p
        role="alert"
        className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-sm text-amber-800"
      >
        ไม่สามารถโหลดข้อมูลข้อความได้ กรุณาลองใหม่อีกครั้ง
      </p>
    )
  }
  if (!data.length || data.every((point) => point.messages === 0)) {
    return (
      <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm leading-6 text-slate-600">
        ยังไม่มีข้อความในช่วงเวลานี้
        <br />
        <span className="text-xs text-slate-500">
          เมื่อมีลูกค้าทักเข้ามา สถิติรายวันจะแสดงที่นี่
        </span>
      </p>
    )
  }

  const max = Math.max(1, ...data.map((point) => Math.max(point.messages, point.customers)))
  const scale = max * 1.15
  const width = chartWidth - padding.left - padding.right
  const height = chartHeight - padding.top - padding.bottom
  const x = (index: number) =>
    padding.left + (data.length < 2 ? width / 2 : (index / (data.length - 1)) * width)
  const y = (value: number) => padding.top + height - (value / scale) * height
  const labelsEvery = Math.max(1, Math.ceil(data.length / 7))
  const ticks = [0, 0.5, 1]

  return (
    <figure aria-label="กราฟจำนวนข้อความและลูกค้าที่ทักเข้ามา">
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          ข้อความที่ได้รับ
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-pink-500" />
          ลูกค้าที่ไม่ซ้ำกัน
        </span>
      </div>
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="จำนวนข้อความที่ได้รับและจำนวนลูกค้าที่ไม่ซ้ำกันในแต่ละวัน"
          className="h-auto w-full overflow-visible"
        >
          {ticks.map((tick) => {
            const value = Math.round(scale * tick)
            const yPosition = y(value)
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={chartWidth - padding.right}
                  y1={yPosition}
                  y2={yPosition}
                  stroke="#e2e8f0"
                  strokeDasharray="3 5"
                />
                <text
                  x={padding.left - 8}
                  y={yPosition + 4}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                >
                  {number(value)}
                </text>
              </g>
            )
          })}
          <path
            d={`${linePath(
              data.map((point) => point.messages),
              scale,
            )} L ${x(data.length - 1)} ${padding.top + height} L ${x(0)} ${padding.top + height} Z`}
            fill="#f97316"
            opacity=".08"
          />
          <path
            d={`${linePath(
              data.map((point) => point.customers),
              scale,
            )} L ${x(data.length - 1)} ${padding.top + height} L ${x(0)} ${padding.top + height} Z`}
            fill="#ec4899"
            opacity=".07"
          />
          <path
            d={linePath(
              data.map((point) => point.messages),
              scale,
            )}
            fill="none"
            stroke="#f97316"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={linePath(
              data.map((point) => point.customers),
              scale,
            )}
            fill="none"
            stroke="#ec4899"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data.map((point, index) => (
            <g key={point.key}>
              <circle
                cx={x(index)}
                cy={y(point.messages)}
                r="3.5"
                fill="#f97316"
                stroke="white"
                strokeWidth="1.5"
              >
                <title>{`${point.label}: ข้อความที่ได้รับ ${number(point.messages)} ข้อความ`}</title>
              </circle>
              <circle
                cx={x(index)}
                cy={y(point.customers)}
                r="3.5"
                fill="#ec4899"
                stroke="white"
                strokeWidth="1.5"
              >
                <title>{`${point.label}: ลูกค้าที่ไม่ซ้ำกัน ${number(point.customers)} คน`}</title>
              </circle>
            </g>
          ))}
          {data.map((point, index) =>
            index % labelsEvery === 0 || index === data.length - 1 ? (
              <text
                key={point.key}
                x={x(index)}
                y={chartHeight - 8}
                textAnchor="middle"
                fill="#64748b"
                fontSize="10"
              >
                {point.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <table className="sr-only">
        <caption>สถิติการทักข้อความจากลูกค้า</caption>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>ข้อความที่ได้รับ</th>
            <th>ลูกค้าที่ไม่ซ้ำกัน</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.key}>
              <td>{point.label}</td>
              <td>{point.messages}</td>
              <td>{point.customers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export function HourlyActivityChart({ data }: { data: HourActivityPoint[] | null }) {
  if (data === null) {
    return (
      <p
        role="alert"
        className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-sm text-amber-800"
      >
        ไม่สามารถโหลดข้อมูลช่วงเวลาได้ กรุณาลองใหม่อีกครั้ง
      </p>
    )
  }
  const max = Math.max(1, ...data.map((point) => point.messages))
  const peak = data.reduce<HourActivityPoint | null>(
    (best, point) => (point.messages > (best?.messages ?? 0) ? point : best),
    null,
  )
  return (
    <div>
      <div
        className="flex h-52 items-end gap-1.5 sm:gap-2"
        role="img"
        aria-label="จำนวนข้อความที่ได้รับในแต่ละช่วงเวลา"
      >
        {data.map((point) => (
          <div
            key={point.label}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end text-center"
          >
            <span className="mb-1 text-[10px] font-semibold tabular-nums text-slate-600">
              {point.messages ? number(point.messages) : ''}
            </span>
            <div
              className="relative flex h-36 items-end rounded-t-md bg-orange-50"
              title={`${point.label}: ${number(point.messages)} ข้อความ`}
            >
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-orange-500 to-orange-300 transition-[height] group-hover:from-orange-600 group-hover:to-orange-400"
                style={{
                  height: `${Math.max(point.messages ? 4 : 0, (point.messages / max) * 100)}%`,
                }}
              />
            </div>
            <span className="mt-2 whitespace-nowrap text-[9px] text-slate-500 sm:text-[10px]">
              {point.label.slice(0, 5)}
            </span>
          </div>
        ))}
      </div>
      {peak?.messages ? (
        <p className="mt-4 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-5 text-orange-900">
          ลูกค้าทักมากที่สุดช่วง <strong>{peak.label} น.</strong> มีข้อความ {number(peak.messages)}{' '}
          ข้อความ
        </p>
      ) : (
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
          ยังไม่มีข้อความในช่วงเวลานี้
        </p>
      )}
      <table className="sr-only">
        <caption>จำนวนข้อความจากลูกค้าในแต่ละช่วงเวลา</caption>
        <thead>
          <tr>
            <th>ช่วงเวลา</th>
            <th>จำนวนข้อความ</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.label}>
              <td>{point.label}</td>
              <td>{point.messages}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
