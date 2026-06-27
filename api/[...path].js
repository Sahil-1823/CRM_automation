import { dispatch } from "../lib/router.js";

export default async function handler(req, res) {
  return dispatch(req, res);
}
