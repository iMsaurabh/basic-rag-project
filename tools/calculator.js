export function calculator({ expression }) {
    try {
        const result = eval(expression);
        return `${expression} = ${result}`;
    } catch (error) {
        return `Error: Invalid expression "${expression}". ${error.message}`;
    }
}