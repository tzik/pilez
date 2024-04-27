import pile_css from "./pile.css" with {type: "css"};

await new Promise(resolve => {
  let check = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', check);
    } else {
      resolve();
    }
  };
  check();
});

function fall(x) {
  let y = 0;
  let offset = 0;
  while (x) {
    if (x & 0xf) {
      y |= (x & 0xf) << offset;
      offset += 4;
    }
    x >>= 4;
  }
  return y;
}

function op_i(xs) {
  xs.push(0x000f);
  return xs;
}

function op_c(xs) {
  xs.push(fall(xs.pop() & 0x3333));
  return xs;
}

function op_r(xs) {
  let x = xs.pop();
  xs.push(((x << 1) & 0xeeee) | ((x >> 3) & 0x1111));
  return xs;
}

function op_s(xs) {
  let y = xs.pop() << 16;  // upper
  let x = xs.pop();  // lower
  for (let i = 0; i < 4; ++i) {
    if (x & (y >> 4)) {
      break;
    }
    y >>= 4;
  }
  xs.push((x | y) & 0xffff);
  return xs;
}

function evaluate(recipe) {
  let xs = [];
  let handlers = new Map();

  handlers.set('i', op_i);
  handlers.set('c', op_c);
  handlers.set('r', op_r);
  handlers.set('s', op_s);

  for (let op of recipe)
    handlers.get(op)(xs);
  return xs;
}

class Pile extends HTMLElement {
  #canvas;
  code;
  hooks = [];

  parse_attr() {
    let attr = this.getAttribute('data-code') || '0000';
    if (!attr.match(/^[0-9a-f]{1,4}$/)) {
      console.log('Unknown pile code: ' + attr);
      return;
    }
    this.code = parseInt(attr, 16);

    // this.#is_input = this.classList.has('input');
    // this.#is_output = this.classList.has('output');
  }

  connectedCallback() {
    let shadow_root = this.attachShadow({mode: 'open'});
    shadow_root.adoptedStyleSheets = [pile_css];
    this.#canvas = document.createElement('canvas');
    shadow_root.append(this.#canvas);
    this.parse_attr();

    this.draw();
    this.addEventListener('resize', () => {draw();});

    if (this.classList.contains('output') || this.classList.contains('input')) {
      this.setAttribute('draggable', true);
      this.addEventListener('dragstart', e => {this.onDrag();});
    }

    if (this.classList.contains('input')) {
      this.addEventListener('dragover', e => {e.preventDefault();});
      this.addEventListener('drop', e => {
        e.preventDefault();
        let data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        let {code, recipe} = JSON.parse(data);
        if (typeof recipe !== 'string' || !recipe.match(/^[ircs]+$/))
          return;
        if (typeof code !== 'number' || code <= 0 || code > 0xffff)
          return;

        let xs = evaluate(recipe);
        if (xs.length !== 1 || xs[0] !== code)
          return;

        this.code = code;
        this.draw();

        for (let hook of this.hooks) {
          hook();
        }
      });
    }

  }

  draw() {
    let context = this.#canvas.getContext('2d');
    let margin = 3;
    let ox = margin;
    let oy = margin;
    let w = this.#canvas.width - 2 * margin;
    let h = this.#canvas.height - 2 * margin;

    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    context.beginPath();
    context.fillStyle = '#999';
    for (let j = 0; j < 4; ++j) {
      for (let i = 0; i < 4; ++i) {
        if (this.code & (1 << (4*j+i))) {
          context.rect(ox+w*(3-i)/4, oy+h*(3-j)/4, w/4, h/4);
        }
      }
    }
    context.fill();

    context.beginPath();
    context.lineWidth = margin;
    context.strokeStyle = 'black';
    context.rect(ox, oy, w, h);
    for (let i = 1; i < 4; ++i) {
      context.moveTo(ox, oy+i*h/4);
      context.lineTo(ox+w, oy+i*h/4);
      context.moveTo(ox+i*w/4, oy);
      context.lineTo(ox+i*w/4, oy+h);
    }
    context.stroke();
  }

  onDrag() {
    let data = JSON.stringify({
      'code': this.code,
      'recipe': history.get(this.code)
    });
    event.dataTransfer.setData('application/json', data);
    event.dataTransfer.setData('text/plain', data);
    event.dataTransfer.effectAllowed = 'copy';
  }
}
customElements.define('x-pile', Pile)

let $ = document.querySelectorAll.bind(document);
let history = new Map;

function register_history(code, recipe) {
  let prev = history.get(code);
  if (typeof prev !== 'string' || prev.length > recipe.length) {
    history.set(code, recipe);
  }
}

register_history(0x000f, 'i');

(() => {
  let [x] = $("#cut .input");
  let [y] = $("#cut .output");
  x.hooks.push(() => {
    [y.code] = op_c([x.code]);
    register_history(y.code, history.get(x.code) + 'c');
    y.draw();
  });
})();

(() => {
  let [x] = $("#rot .input");
  let [y] = $("#rot .output");
  x.hooks.push(() => {
    [y.code] = op_r([x.code]);
    register_history(y.code, history.get(x.code) + 'r');
    y.draw();
  });
})();

(() => {
  let [x,y] = $("#stack .input");
  let [z] = $("#stack .output");
  let run = () => {
    [z.code] = op_s([x.code, y.code]);
    register_history(z.code, history.get(x.code) + history.get(y.code) + 's');
    z.draw();
  };

  x.hooks.push(run);
  y.hooks.push(run);
})();

(() => {
  let [level] = $('#level');
  let [goal] = $('#goal');
  let [next] = $('#next');

  let [attempt] = $('#attempt');
  let [result] = $('#result');
  let check = () => {
    if (attempt.code === goal.code) {
      result.classList.add('pass');
      result.textContent = '===';
      let opts = level.options;
      next.disabled = opts.selectedIndex === opts.length - 1;
    } else {
      result.classList.remove('pass');
      result.textContent = '!==';
      next.disabled = true;
    }
  };
  attempt.hooks.push(check);

  let level_switch = () => {
    goal.code = parseInt(level.value, 16);
    goal.draw();
    check();
  };
  level.addEventListener('change', level_switch);

  next.addEventListener('click', () => {
    let opts = level.options;
    if (opts.selectedIndex < opts.length - 1) {
      opts.selectedIndex += 1;
      level_switch();
    }
  });
})();
