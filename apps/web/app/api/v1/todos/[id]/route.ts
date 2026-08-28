import { updateTodoSchema } from '@keel/contracts/todo';
import { deleteTodo, getTodo, updateTodo } from '@keel/testbed-todos';
import { fail, json, parseBody, withScope } from '../../_api.ts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const row = await getTodo(scope, id);
    if (!row) return fail(404, 'not_found', 'No such todo.');
    return json({
      data: {
        id: row.id,
        listId: row.listId,
        title: row.title,
        done: row.done,
        notes: row.notes,
        dueDate: row.dueDate,
        priority: row.priority,
      },
    });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const parsed = await parseBody(request, updateTodoSchema);
    if ('response' in parsed) return parsed.response;

    const row = await updateTodo(scope, id, parsed.data);
    if (!row) return fail(404, 'not_found', 'No such todo.');
    return json({ data: { id: row.id, title: row.title, done: row.done } });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const removed = await deleteTodo(scope, id);
    if (!removed) return fail(404, 'not_found', 'No such todo.');
    return new Response(null, { status: 204, headers: { 'x-keel-api-version': 'v1' } });
  });
}
