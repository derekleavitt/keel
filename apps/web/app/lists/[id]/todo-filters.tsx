import { TODO_PRIORITIES, type TodoFilter } from '@keel/contracts/todo';

type TagOption = { id: string; name: string };

/**
 * Filters as a plain GET form.
 *
 * A server component with no client JavaScript: the browser submits, the page re-renders
 * with the new query string, and the filter state is in the URL — so it survives a reload
 * and can be shared. `typedRoutes` also checks route *literals*, which makes computed
 * `Link` hrefs awkward; a form sidesteps that entirely.
 */
export function TodoFilters({
  filter,
  tags,
  active,
}: {
  filter: TodoFilter;
  tags: TagOption[];
  active: boolean;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Status</span>
        <select
          name="done"
          aria-label="Filter by status"
          defaultValue={filter.done === undefined ? '' : String(filter.done)}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
        >
          <option value="">Any</option>
          <option value="false">Outstanding</option>
          <option value="true">Completed</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Priority</span>
        <select
          name="priority"
          aria-label="Filter by priority"
          defaultValue={filter.priority?.[0] ?? ''}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
        >
          <option value="">Any</option>
          {TODO_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      {tags.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Tag</span>
          <select
            name="tag"
            aria-label="Filter by tag"
            defaultValue={filter.tagIds?.[0] ?? ''}
            className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
          >
            <option value="">Any</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="submit"
        className="h-8 rounded-md border border-line bg-surface-2 px-3 text-xs font-medium"
      >
        Apply
      </button>

      {active && (
        <a href="?" className="h-8 px-1 text-xs text-accent underline underline-offset-4">
          Clear filters
        </a>
      )}
    </form>
  );
}
