<state label="Avenx" count="2" />
<action name="update">label = 'Updated'; count = 5;</action>
<section>
  <button data-testid="update-slot" @click="update()">Update slot</button>
  <slot :label="label" :count="count"><p data-testid="slot-fallback">Fallback: {{ label }}</p></slot>
</section>
