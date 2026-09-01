<h1 data-testid="heading">Timer</h1>

<@defer when="timer(1500)">
  <@placeholder>
    <p data-testid="timer-placeholder">Waiting for the timer</p>
  </@placeholder>
  <p data-testid="timer-content">Loaded after the timer elapsed</p>
</@defer>
