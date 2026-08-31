<state name="Ada" bio="" subscribed="false" fruits="['apple']" plan="free" city="berlin" ticker="0" />

<action name="bumpTicker"> state.ticker = state.ticker + 1; </action>

<action name="renameFromCode"> state.name = 'Grace'; </action>

<main>
  <h1 data-testid="heading">Forms</h1>

  <!-- Text: binds through `value`, listens for `input`. -->
  <label for="name-input">Name</label>
  <input id="name-input" type="text" data-ax-bind="name" data-testid="name-input" @keydown.enter="bumpTicker()" />
  <p data-testid="name-output">{{ name }}</p>

  <!-- Textarea: same channel as text. -->
  <textarea data-ax-bind="bio" data-testid="bio-input"></textarea>
  <p data-testid="bio-output">{{ bio }}</p>

  <!-- Checkbox bound to a boolean: binds through `checked`. -->
  <input type="checkbox" data-ax-bind="subscribed" data-testid="subscribed-input" />
  <p data-testid="subscribed-output">{{ subscribed }}</p>

  <!-- Checkbox group bound to an array: membership drives `checked`. -->
  <input type="checkbox" value="apple" data-ax-bind="fruits" data-testid="fruit-apple" />
  <input type="checkbox" value="banana" data-ax-bind="fruits" data-testid="fruit-banana" />
  <p data-testid="fruits-output">{{ fruits.join(',') }}</p>

  <!-- Radio group: one bound value shared by the group. -->
  <input type="radio" name="plan" value="free" data-ax-bind="plan" data-testid="plan-free" />
  <input type="radio" name="plan" value="pro" data-ax-bind="plan" data-testid="plan-pro" />
  <p data-testid="plan-output">{{ plan }}</p>

  <!-- Select: binds through `value`, listens for `change`. -->
  <select data-ax-bind="city" data-testid="city-input">
    <option value="berlin">Berlin</option>
    <option value="lisbon">Lisbon</option>
    <option value="oslo">Oslo</option>
  </select>
  <p data-testid="city-output">{{ city }}</p>

  <!-- Unrelated state, used to force a patch while a field holds focus. -->
  <p data-testid="ticker">{{ ticker }}</p>
  <button data-testid="rename" @click="renameFromCode()">Rename from code</button>
</main>
