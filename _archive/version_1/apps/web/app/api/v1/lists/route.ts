import { createListSchema } from '@keel/contracts/list';
import { createList, listLists } from '@keel/testbed-lists';
import { fail, json, parseBody, withScope } from '../_api.ts';

export const dynamic = 'force-dynamic';

/** Every list visible to the caller — owned or shared, exactly as the web UI sees them. */
export async function GET(request: Request) {
  return withScope(request, async (scope) => {
    const rows = await listLists(scope);
    return json({
      data: rows.map(({ id, name, colour, position }) => ({ id, name, colour, position })),
    });
  });
}

export async function POST(request: Request) {
  return withScope(request, async (scope) => {
    const parsed = await parseBody(request, createListSchema);
    if ('response' in parsed) return parsed.response;

    const row = await createList(scope, parsed.data);
    // 201 with a Location header: the client learns the id without parsing the body.
    return new Response(JSON.stringify({ data: { id: row.id, name: row.name } }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        location: `/api/v1/lists/${row.id}`,
        'x-keel-api-version': 'v1',
      },
    });
  });
}

// Present so an unsupported verb answers 405 with the allowed set rather than 404, which
// would otherwise read as "wrong URL".
export async function PUT() {
  return fail(405, 'method_not_allowed', 'Use GET or POST on this collection.');
}
