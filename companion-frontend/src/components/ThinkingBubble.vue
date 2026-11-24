<template>
  <div class="thinking-cloud" aria-hidden="true">
    <svg viewBox="0 0 152 114" focusable="false">
      <circle class="thought-small" cx="27" cy="101" r="5" />
      <ellipse class="thought-medium" cx="40" cy="85" rx="10" ry="8" />
      <g class="thought-large">
        <path d="M43 70C29 70 22 61 25 50C15 36 24 22 39 22C46 9 62 9 72 17C84 7 101 12 105 24C123 19 138 31 134 45C149 57 139 76 124 76H47C45 75 43 73 43 70Z" />
        <circle class="thought-spark" cx="67" cy="46" r="3" />
        <circle class="thought-spark" cx="84" cy="46" r="3" />
        <circle class="thought-spark" cx="101" cy="46" r="3" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.thinking-cloud{position:absolute;width:152px;height:114px;transform:translate(-50%,-100%);z-index:6;pointer-events:none!important;user-select:none;filter:drop-shadow(0 5px 12px #49335318)}
svg{display:block;width:100%;height:100%;overflow:visible;fill:#fffafef5;stroke:#cbb5dd;stroke-width:1.5;stroke-linejoin:round}
.thought-small,.thought-medium,.thought-large{transform-box:fill-box;transform-origin:center;animation:thought-grow 2.8s ease-in-out infinite;opacity:0}
.thought-small{animation-delay:0s}.thought-medium{animation-delay:.18s}.thought-large{animation-delay:.4s;transform-origin:25% 90%}
.thought-spark{fill:#b796cd;stroke:none;animation:thought-glimmer 1.4s ease-in-out infinite}.thought-spark:nth-of-type(2){animation-delay:.16s}.thought-spark:nth-of-type(3){animation-delay:.32s}
@keyframes thought-grow{0%,8%{opacity:0;transform:scale(.35)}20%,74%{opacity:1;transform:scale(1)}87%,100%{opacity:0;transform:scale(.9)}}
@keyframes thought-glimmer{0%,100%{opacity:.35}50%{opacity:.9}}
@media(prefers-reduced-motion:reduce){.thought-small,.thought-medium,.thought-large{animation:none;opacity:1;transform:none}.thought-spark{animation:none}}
</style>
