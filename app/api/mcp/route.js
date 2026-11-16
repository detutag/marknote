import { NextResponse } from 'next/server';
import { getMcpToken, isMcpReadonly } from '@/lib/config';
import {
  createCategory,
  createNote,
  deleteNote,
  getNote,
  listCategories,
  listNotes,
  listTags,
  searchNotes,
  updateNote,
} from '@/lib/data';
import { RPC, createMcpHandler, errorResponse, verifyBearer } from '@/lib/mcp';

/**
 * MCP 端點（Streamable HTTP 傳輸，無狀態）。
 *
 *   POST /api/mcp   Authorization: Bearer <MCP_TOKEN>
 *   body：單一 JSON-RPC 訊息或批次陣列；回應為 application/json。
 *
 * 不使用 cookie session（middleware 放行此路徑），改由 MCP_TOKEN 驗證；
 * 未設定 MCP_TOKEN 時端點回 404，等同停用。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const dataApi = { listNotes, searchNotes, getNote, createNote, updateNote, deleteNote, listCategories, listTags, createCategory };

const rpcJson = (body, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function authorize(req) {
  const token = getMcpToken();
  if (!token) return rpcJson(errorResponse(null, RPC.INVALID_REQUEST, 'MCP 未啟用：請設定 MCP_TOKEN 環境變數'), 404);
  const header = req.headers.get('authorization') || (req.headers.get('x-mcp-token') ? `Bearer ${req.headers.get('x-mcp-token')}` : '');
  if (!(await verifyBearer(header, token))) {
    return NextResponse.json(errorResponse(null, RPC.INVALID_REQUEST, '未授權：請在 Authorization 標頭帶上 Bearer <MCP_TOKEN>'), {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="marknote-mcp"', 'cache-control': 'no-store' },
    });
  }
  return null;
}

export async function POST(req) {
  const denied = await authorize(req);
  if (denied) return denied;

  let payload;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return rpcJson(errorResponse(null, RPC.PARSE_ERROR, '請求內容不是合法的 JSON'), 400);
  }

  const handle = createMcpHandler(dataApi, { readonly: isMcpReadonly() });

  if (Array.isArray(payload)) {
    if (!payload.length) return rpcJson(errorResponse(null, RPC.INVALID_REQUEST, '批次請求不可為空陣列'), 400);
    const results = (await Promise.all(payload.map((m) => handle(m)))).filter(Boolean);
    if (!results.length) return new Response(null, { status: 202 });
    return rpcJson(results);
  }

  const result = await handle(payload);
  // 只有通知／回應時，依規格回 202 Accepted、沒有 body
  if (!result) return new Response(null, { status: 202 });
  return rpcJson(result);
}

/** 本伺服器不提供 server→client 的 SSE 串流 */
export async function GET(req) {
  const denied = await authorize(req);
  if (denied) return denied;
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}

/** 無狀態伺服器，沒有 session 可以結束 */
export async function DELETE(req) {
  const denied = await authorize(req);
  if (denied) return denied;
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
