import todos from '../../global/todos.bridge.js';

<div>
    <@css card />

    <h1 @css title>Things to do</h1>
    <p @css hint>{{ todos.remaining }} left. Reload the page — the list is still here.</p>

    <form @css row @submit.prevent="todos.add()">
        <input
            @css input
            type="text"
            placeholder="What needs doing?"
            :value="todos.draft"
            @input="todos.setDraft(event.target.value)"
        />
        <button @css primary type="submit">Add</button>
    </form>

    <div @css row>
        <button @css filter @click="todos.setFilter('all')">All</button>
        <button @css filter @click="todos.setFilter('active')">Active</button>
        <button @css filter @click="todos.setFilter('done')">Done</button>
        <button @css filter @click="todos.clearDone()">Clear done</button>
    </div>

    <ul @css list>
        <@for item in todos.visible key="item.id">
            <li @css item>
                <button @css toggle type="button" data-id="{{ item.id }}" @click="todos.toggle(event.target.dataset.id)">
                    {{ item.done ? '☑' : '☐' }} {{ item.text }}
                </button>
            </li>
        </@for>
    </ul>
</div>
