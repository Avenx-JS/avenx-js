<state likes="4" liked="false" />

<action name="like" atomic>
  likes++;
  liked = true;
</action>

<action name="unlike" atomic>
  likes--;
  liked = false;
</action>

<div @css card>
  <span @css count>{{ likes }}</span>
  <span @css state>{{ liked }}</span>
  <button @css up @click="like()">like</button>
  <button @css down @click="unlike()">unlike</button>
</div>
