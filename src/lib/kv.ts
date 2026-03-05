type KvConfig = { url: string; token: string }

export function resolveKvConfig(): KvConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.OPENCLAW_KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.OPENCLAW_KV_REST_API_TOKEN
  if (!url || !token) return null
  return { url, token }
}

export async function kvPipeline(config: KvConfig, command: unknown[]) {
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`kv_http_${response.status}`)
  }

  const json = (await response.json()) as Array<{ result?: unknown; error?: string }>
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("kv_invalid_response")
  }

  const first = json[0]
  if (first.error) {
    throw new Error(`kv_${first.error}`)
  }

  return first.result
}

export async function kvGetJson<T>(config: KvConfig, key: string): Promise<T | null> {
  const result = await kvPipeline(config, ["GET", key])
  if (result == null || typeof result !== "string") return null
  try {
    return JSON.parse(result) as T
  } catch {
    return null
  }
}

export async function kvSetJson(config: KvConfig, key: string, value: unknown) {
  await kvPipeline(config, ["SET", key, JSON.stringify(value)])
}
