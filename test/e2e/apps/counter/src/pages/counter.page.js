<state count="0" step="1" />

<computed name="doubled" value="count * 2" />
<computed name="isZero" value="count === 0" />

<action name="increment"> count = count + step; </action>

<action name="decrement"> count = count - step; </action>

<action name="reset"> count = 0; </action>

<action name="useLargeStep"> step = 10; </action>

<main @css panel>
  <h1 @css title data-testid="heading">Avenx counter</h1>

  <p data-testid="count">{{ count }}</p>
  <p data-testid="doubled">{{ doubled }}</p>
  <p data-testid="step">{{ step }}</p>

  <button data-testid="increment" @click="increment()">Increment</button>
  <button data-testid="decrement" @click="decrement()">Decrement</button>
  <button data-testid="reset" disabled="{{ isZero }}" @click="reset()">Reset</button>
  <button data-testid="large-step" @click="useLargeStep()">Use a step of 10</button>
</main>
