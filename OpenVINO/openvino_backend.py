from typing import Dict, List, Callable
from os import path
from interface import LLMInterface
from params import LLMParams
import config
import openvino_genai
import gc

class OpenVino(LLMInterface):
    def __init__(self):
        self._model = None
        self.stop_generate = False
        self._last_repo_id = None

    def load_model(self, params: LLMParams, callback: Callable[[str], None] = None):
        model_repo_id = params.model_repo_id
        if self._model is None or self._last_repo_id != model_repo_id:
            if callback is not None:
                callback("start")
            self.unload_model()
            callback(params.model_repo_id)

            model_base_path = config.openvino_model_paths.get("openvinoLLM")
            model_name = model_repo_id.replace("/", "---")
            model_path = path.abspath(path.join(model_base_path, model_name))

            enable_compile_cache = dict()
            enable_compile_cache["CACHE_DIR"] = "llm_cache"
            self._model = openvino_genai.LLMPipeline(model_path, "AUTO", **enable_compile_cache)
            self._tokenizer = self._model.get_tokenizer()

            self._last_repo_id = model_repo_id
            if callback is not None:
                callback("finish")


    def create_chat_completion(self, messages: List[Dict[str, str]], streamer: Callable[[str], None], max_tokens: int = 1024):
        config = openvino_genai.GenerationConfig()
        config.max_new_tokens = max_tokens

        full_prompt = self._tokenizer.apply_chat_template(messages, add_generation_prompt=True)
        return self._model.generate(full_prompt, config, streamer)


    def unload_model(self):
        if self._model is not None:
            del self._model
        gc.collect()
        self._model = None

    def get_backend_type(self):
        return "openvino"