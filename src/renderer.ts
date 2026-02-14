import './index.css';

const button = document.getElementById('click-toggle');

if (button) {
  button.addEventListener('click', () => {
    button.textContent = 'Click-through: OFF (예정)';
  });
}
