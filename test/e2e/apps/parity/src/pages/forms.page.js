<!--
  data-ax-bind across every documented control, on a page that compiles to a
  render program. The bound values are rendered through JSON.stringify, so a
  number written back as a string is a visible difference.
-->
<state text="'Ada'" bio="'hello'" age="7" volume="50" when="'2026-11-20'" city="'lisbon'" cities="['oslo']" agreed="false" fruits="['apple']" plan="'free'" />

<main>
  <h1 data-testid="heading">Forms</h1>

  <section data-construct="bind">
    <input type="text" data-ax-bind="text" data-testid="text" aria-label="text" />
    <textarea data-ax-bind="bio" data-testid="bio" aria-label="bio"></textarea>
    <input type="number" data-ax-bind="age" data-testid="age" aria-label="age" />
    <input type="range" min="0" max="100" data-ax-bind="volume" data-testid="volume" aria-label="volume" />
    <input type="date" data-ax-bind="when" data-testid="when" aria-label="when" />
    <select data-ax-bind="city" data-testid="city" aria-label="city">
      <option value="berlin">Berlin</option>
      <option value="lisbon">Lisbon</option>
    </select>
    <select multiple data-ax-bind="cities" data-testid="cities" aria-label="cities">
      <option value="berlin">Berlin</option>
      <option value="oslo">Oslo</option>
    </select>
    <input type="checkbox" data-ax-bind="agreed" data-testid="agreed" aria-label="agreed" />
    <input type="checkbox" value="apple" data-ax-bind="fruits" data-testid="fruit-apple" aria-label="fruit-apple" />
    <input type="checkbox" value="pear" data-ax-bind="fruits" data-testid="fruit-pear" aria-label="fruit-pear" />
    <input type="radio" name="plan" value="free" data-ax-bind="plan" data-testid="plan-free" aria-label="plan-free" />
    <input type="radio" name="plan" value="pro" data-ax-bind="plan" data-testid="plan-pro" aria-label="plan-pro" />
    <pre data-testid="bound">{{ JSON.stringify({ text: text, bio: bio, age: age, volume: volume, when: when, city: city, cities: cities, agreed: agreed, fruits: fruits, plan: plan }) }}</pre>
  </section>
</main>
