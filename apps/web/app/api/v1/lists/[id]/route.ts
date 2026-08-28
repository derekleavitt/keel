import { updateListSchema } from '@keel/contracts/list';
import { deleteList, getList, updateList } from '@keel/testbed-lists';
import { listTodos } from '@keel/testbed-todos';
import { fail, json, parseBody, withScope } from '../../_api.ts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const list = await getList(scope, id);
    /*
     * 404, not 403, for a list belonging to someone else. Distinguishing them confirms the
     * id exists — an enumeration oracle. The query layer already returns null for both, so
     * this is the natural answer rather than a special case.
     */
    if (!list) return fail(404, 'not_found', 'No such list.');

    const todos = await listTodos(scope, id, {});
    return json({
      data: {
        id: list.id,
        name: list.name,
        colour: list.colour,
        todos: todos.map(({ id, title, done, dueDate, priority }) => ({
          id,
          title,
          done,
          dueDate,
          priority,
        })),
      },
    });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const parsed = await parseBody(request, updateListSchema);
    if ('response' in parsed) return parsed.response;

    const row = await updateList(scope, id, parsed.data);
    if (!row) return fail(404, 'not_found', 'No such list.');
    return json({ data: { id: row.id, name: row.name, colour: row.colour } });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withScope(request, async (scope) => {
    const { id } = await params;
    const removed = await deleteList(scope, id);
    if (!removed) return fail(404, 'not_found', 'No such list.');
    // 204: there is no representation of a deleted list to return.
    return new Response(null, { status: 204, headers: { 'x-keel-api-version': 'v1' } });
  });
}
