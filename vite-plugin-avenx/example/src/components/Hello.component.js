<state
    count="0"
    name="Hello"
/>

<action name="reset">
    count = 0;
</action>

<div>
    <@css container />
    <h1 @css title>{{ name }} Component</h1>
    <p @css text>Current count: {{ count }}</p>

    <button @css button @click="count++">
        Increment
    </button>

    <button @css button @click="reset()">
        Reset
    </button>
</div>