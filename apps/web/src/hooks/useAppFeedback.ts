import { App } from "antd";

export function useAppFeedback() {
	const { message, modal } = App.useApp();

	return {
		messageApi: message,
		modalApi: modal,
	};
}
