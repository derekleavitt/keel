import { createTodoSchema } from '@keel/contracts/todo';
import { createTodo, listTodos } from '@keel/testbed-todos';
import { fail, json, parseBody, withScope } from '../_api.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withScope(request, async (scope) => {
    const listId = new URL(request.url).searchParams.get('listId');
    if (!listId) return fail(400, 'missing_parameter', 'listId is required.');

    const rows = await listTodos(scope, listId, {});
    return json({
      data: rows.map(({ id, title, done, dueDate, priority, listId }) => ({
        id,
        listId,
        title,
        done,
        dueDate,
        priority,
      })),
    });
  });
}

export async function POST(request: Request) {
  return withScope(request, async (scope) => {
    const parsed = await parseBody(request, createTodoSchema);
    if ('response' in parsed) return parsed.response;

    const row = await createTodo(scope, parsed.data);
    // Null means the list is not one the caller may write to — same answer as a list that
    // does not exist, for the same enumeration reason as above.
    if (!row) return fail(404, 'not_found', 'No such list.');

    return new Response(JSON.stringify({ data: { id: row.id, title: row.title } }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        location: `/api/v1/todos/${row.id}`,
        'x-keel-api-version': 'v1',
      },
    });
  });
}
