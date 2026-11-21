    },
    { session },
  );

  // Let the router's deferred initial navigation finish before measuring the
  // explicit navigation below; otherwise both attempts can run these guards.
  await settle();
  order.length = 0;
  router.navigate('#/secret');
  await settle();
  assert.deepStrictEqual(order, ['auth', 'role'], 'guards run in declaration order');