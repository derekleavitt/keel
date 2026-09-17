# Todo — product requirements

A todo app people actually keep using. The bar is not "can you check a box" — it is
that someone with 300 open items can still find the four that matter today.

## Who it's for

Individuals managing personal and work tasks in one place. Not teams, not yet. But the
data model should not make collaboration impossible to add later.

## The core objects

**Lists.** Everything lives in a list. Users make their own — "Work", "Groceries",
"Someday". A list has a name, an optional colour, and a position so users can reorder
them. Deleting a list should not silently destroy its todos; ask first, and offer to
move them.

**Todos.** A title, optional longer notes, a done state, an optional due date, and a
priority (none / low / medium / high). Every todo belongs to exactly one list. Users
reorder todos within a list by dragging. Completed todos stay visible but sink to the
bottom, and can be hidden.

**Tags.** Cross-cutting labels — "urgent", "waiting-on", "5-minutes". A todo can have
many tags, a tag applies to many todos. Tags are global to the user, not per-list, and
that is the point: they are how you slice across lists. Tags have a name and a colour.

## What people need to do

- Sign up, sign in, sign out. Email and password is fine for now.
- Create, rename, reorder, and delete lists.
- Add a todo quickly — typing a title and hitting enter should be enough. Everything
  else is optional and editable later.
- Mark todos done and undone.
- Set due dates and priorities.
- Add and remove tags on a todo, and create a new tag inline while doing it.
- Filter the current list by tag, by priority, and by done state.
- See a cross-list view of everything due today or overdue. This is the screen people
  will actually open every morning.
- Search todos by title and notes.

## Rules that matter

- A user only ever sees their own data. This is not negotiable and should be enforced
  at the query layer, not just in the UI.
- Deleting a tag removes it from todos but never deletes the todos.
- Due dates are dates, not timestamps. "Due Tuesday" means Tuesday, regardless of
  timezone. Getting this wrong is the classic bug in this category.
- Reordering must survive a page reload, so position is persisted, not derived.
- An empty list and a list whose todos are all filtered out should look different.
  Users read "nothing here" as broken when they meant "nothing matches".

## Explicitly not in scope

Sharing, comments, attachments, recurring todos, subtasks, notifications, mobile apps,
calendar sync. All plausible later; none of them now.

## What good looks like

Adding a todo takes under two seconds from page load. The "due today" view is correct
at midnight without a refresh. Nothing about the app makes the user think about lists
when they just want to write something down.
